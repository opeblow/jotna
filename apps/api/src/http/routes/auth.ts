import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { createSession, destroySession, login, signup, type SellerRow } from "../../domain/auth.js";
import { aiEnabled } from "../../domain/ai.js";
import { shopSummary } from "../../domain/orders.js";
import { platformNpub } from "../../nostr/publisher.js";
import { SESSION_COOKIE } from "../server.js";

const pin = z.string().regex(/^\d{6}$/, "PIN must be 6 digits");
const WEAK_PINS = new Set(["000000", "111111", "123456", "654321", "121212", "112233"]);

const SignupBody = z.object({
  phone: z.string().min(6).max(24),
  pin: pin.refine((p) => !WEAK_PINS.has(p), "Choose a PIN that is harder to guess"),
  shop_name: z.string().trim().min(2).max(40),
  city: z.string().trim().max(40).optional().nullable(),
});
const LoginBody = z.object({ phone: z.string().min(6).max(24), pin });

export async function authRoutes(app: FastifyInstance) {
  const { ctx } = app;

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

  app.post("/auth/signup", authLimit, async (req, reply) => {
    const seller = await signup(ctx, SignupBody.parse(req.body));
    await setSession(reply, seller);
    return reply.status(201).send(await present(seller));
  });

  app.post("/auth/login", authLimit, async (req, reply) => {
    const seller = await login(ctx, LoginBody.parse(req.body));
    await setSession(reply, seller);
    return present(seller);
  });

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(ctx, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (req) => present(await app.requireSeller(req)));
}
