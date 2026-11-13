import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { AppContext } from "../context.js";
import { sellerForSession, type SellerRow } from "../domain/auth.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
import { loggerOptions } from "../lib/logger.js";
import { authRoutes } from "./routes/auth.js";
import { devRoutes } from "./routes/dev.js";
import { publicRoutes } from "./routes/public.js";
import { sellerRoutes } from "./routes/seller.js";

export const SESSION_COOKIE = "jotna_sid";

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
    requireSeller: (req: FastifyRequest) => Promise<SellerRow>;
  }
}

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(ctx.config.LOG_LEVEL),
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    // Query strings are not logged: order links are capabilities and must not end up in log files.
    disableRequestLogging: true,
  });

  app.decorate("ctx", ctx);
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) =>
      Object.assign(new AppError(429, "rate_limited", "Too many requests. Slow down a little."), {
        details: { retry_after_seconds: Math.ceil(context.ttl / 1000) },
      }),
  });

  app.decorate("requireSeller", async (req: FastifyRequest) => {
    const seller = await sellerForSession(ctx, req.cookies[SESSION_COOKIE]);
    if (!seller) throw unauthorized();
    return seller;
  });

  // CSRF defence for cookie-authenticated requests: state-changing calls must come from our own
  // origin and carry a JSON (or binary) body, which a cross-site HTML form cannot produce.
  app.addHook("onRequest", async (req) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin && origin !== ctx.config.WEB_ORIGIN) throw forbidden("bad_origin", "Cross-site requests are not allowed");
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
    const hasBody = Number(req.headers["content-length"] ?? 0) > 0;
    if (hasBody && type !== "application/json" && !type.startsWith("image/")) {
      throw new AppError(415, "unsupported_media_type", "Send JSON");
    }
  });

  app.addHook("onResponse", async (req, reply) => {
    if (req.routeOptions.url === "/healthz") return;
    req.log.info(
      { method: req.method, route: req.routeOptions.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      "request",
    );
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({
        error: {
          code: "invalid_request",
          message: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request",
          details: { fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: "bad_request", message: (err as Error).message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } });
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => {
    await ctx.sql`select 1`;
    return { ok: true, network: ctx.config.NETWORK };
  });

  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(sellerRoutes, { prefix: "/v1" });
  await app.register(publicRoutes, { prefix: "/v1" });
  if (ctx.config.DEV_BUYER_LND_URL) await app.register(devRoutes, { prefix: "/v1" });

  return app;
}
