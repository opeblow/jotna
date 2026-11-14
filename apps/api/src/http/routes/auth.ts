import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createSession, destroySession, login, phoneTaken, signup, trustDevice, type SellerRow } from "../../domain/auth.js";
import { aiEnabled } from "../../domain/ai.js";
import { shopSummary } from "../../domain/orders.js";
import { badRequest, conflict } from "../../lib/errors.js";
import { normalizePhone } from "../../lib/phone.js";
import { isWeakPin } from "../../lib/pin.js";
import { createPhoneVerifier } from "../../lib/verify.js";
import { platformNpub } from "../../nostr/publisher.js";
import { SESSION_COOKIE } from "../server.js";

const DEVICE_COOKIE = "jotna_dev";

const pin = z.string().regex(/^\d{6}$/, "PIN must be 6 digits");

const signupFields = {
  phone: z.string().min(6).max(24),
  pin,
  shop_name: z.string().trim().min(2).max(40),
  city: z.string().trim().max(40).optional().nullable(),
};
const isStrongPin = (b: { pin: string; phone: string }) => !isWeakPin(b.pin, b.phone);
const weakPin = { path: ["pin"], message: "Choose a PIN that is harder to guess" };
const SignupBody = z.object({ ...signupFields, code: z.string().regex(/^\d{4,10}$/).optional() }).refine(isStrongPin, weakPin);
// Asking for a code validates the whole form, so nobody spends a code on a sign-up that would be refused.
const SignupCodeBody = z.object({ ...signupFields, locale: z.enum(["fr", "en"]).default("fr") }).refine(isStrongPin, weakPin);
const LoginBody = z.object({ phone: z.string().min(6).max(24), pin });

export async function authRoutes(app: FastifyInstance) {
  const { ctx } = app;
  const verifier = createPhoneVerifier(ctx.config);
  if (ctx.config.isProd && !verifier) {
    app.log.warn("Phone verification is off: anyone can register any phone number. Set the TWILIO_* variables to turn it on.");
  }

  const setSession = async (reply: FastifyReply, seller: SellerRow) => {
    const { token, expiresAt } = await createSession(ctx, seller.id);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.config.isProd,
      path: "/",
      expires: expiresAt,
    });
  };

  const rememberDevice = async (req: FastifyRequest, reply: FastifyReply, seller: SellerRow) => {
    const token = await trustDevice(ctx, seller.id, req.cookies[DEVICE_COOKIE]);
    if (!token) return;
    reply.setCookie(DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.config.isProd,
      // Only the sign-in endpoint ever needs it.
      path: "/api/v1/auth",
      maxAge: 400 * 86_400,
    });
  };

  const present = async (seller: SellerRow) => {
    const [wallet] = await ctx.sql<
      { kind: string; alias: string | null; network: string | null; last_ok_at: Date | null; last_error: string | null }[]
    >`select kind, alias, network, last_ok_at, last_error from wallets where seller_id = ${seller.id}`;
    return {
      seller: { id: seller.id, phone: seller.phone, shop_name: seller.shop_name, shop_slug: seller.shop_slug, city: seller.city },
      shop: await shopSummary(ctx.sql, seller.id),
      wallet: wallet
        ? { kind: wallet.kind, alias: wallet.alias, network: wallet.network, healthy: !wallet.last_error, last_ok_at: wallet.last_ok_at }
        : null,
      features: {
        ai: aiEnabled(ctx),
        lnd_connect: ctx.config.ENABLE_LND_CONNECT,
        network: ctx.config.NETWORK,
        nostr_npub: platformNpub(ctx),
        min_order_xof: ctx.config.MIN_ORDER_XOF,
        max_order_xof: ctx.config.MAX_ORDER_XOF,
      },
    };
  };

  // Tight per-IP limits on credential endpoints; the per-account lockout lives in the database.
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } };

  const alreadyRegistered = () => conflict("phone_taken", "An account already exists for this number. Sign in instead.");

  // Each code is a paid message to a number the visitor chose, so this is limited harder than the
  // other credential endpoints. The provider adds its own limit per destination number.
  const codeLimit = { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } };

  app.post("/auth/signup/code", codeLimit, async (req) => {
    const body = SignupCodeBody.parse(req.body);
    const phone = normalizePhone(body.phone, ctx.config.DEFAULT_COUNTRY_CODE);
    if (!verifier) return { required: false };
    if (await phoneTaken(ctx, phone)) throw alreadyRegistered();
    await verifier.send(phone, body.locale);
    return { required: true, channel: ctx.config.PHONE_VERIFICATION_CHANNEL };
  });

  app.post("/auth/signup", authLimit, async (req, reply) => {
    const { code, ...input } = SignupBody.parse(req.body);
    if (verifier) {
      const phone = normalizePhone(input.phone, ctx.config.DEFAULT_COUNTRY_CODE);
      if (!code) throw badRequest("code_required", "Enter the code we sent to your phone");
      // Checked first: a code can be used once, and it should not be spent on a number that is taken.
      if (await phoneTaken(ctx, phone)) throw alreadyRegistered();
      await verifier.check(phone, code);
    }
    const seller = await signup(ctx, input);
    await setSession(reply, seller);
    await rememberDevice(req, reply, seller);
    return reply.status(201).send(await present(seller));
  });

  // Sign-in attempts are counted per visitor *and* per phone number, after the body is parsed.
  // Counting per address alone would let one person exhaust the bucket for everybody whenever
  // several visitors share an address (a proxy, a mobile carrier's NAT).
  const loginLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "5 minutes",
        hook: "preHandler" as const,
        keyGenerator: (req: FastifyRequest) =>
          `login:${req.ip}:${String((req.body as { phone?: unknown } | undefined)?.phone ?? "").replace(/\D/g, "").slice(-12)}`,
      },
    },
  };

  app.post("/auth/login", loginLimit, async (req, reply) => {
    const seller = await login(ctx, { ...LoginBody.parse(req.body), deviceToken: req.cookies[DEVICE_COOKIE] });
    await setSession(reply, seller);
    await rememberDevice(req, reply, seller);
    return present(seller);
  });

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(ctx, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req) => present(await app.requireSeller(req)));
}
