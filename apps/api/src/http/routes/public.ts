import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  buyerCancel,
  checkout,
  getOrderByPublicId,
  presentPublicOrder,
  rateOrder,
  release,
  shopSummary,
} from "../../domain/orders.js";
import { notFound } from "../../lib/errors.js";
import { platformNpub } from "../../nostr/publisher.js";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");
const publicId = z.string().regex(/^[2-9a-z]{14}$/);

const CheckoutBody = z.object({ payment_hash: hex64, buyer_key_hash: hex64 });
const ReleaseBody = z.object({ preimage: hex64 });
const CancelBody = z.object({ buyer_key: hex64 });
const RatingBody = z.object({
  buyer_key: hex64,
  stars: z.number().int().min(1).max(5),
  review: z.string().trim().max(280).optional().nullable(),
});

const idOf = (req: FastifyRequest) => {
  const parsed = publicId.safeParse((req.params as { publicId: string }).publicId);
  if (!parsed.success) throw notFound("Order");
  return parsed.data;
};

const buyerKeyOf = (req: FastifyRequest) => {
  const header = req.headers["x-jotna-buyer"];
  return typeof header === "string" ? header : null;
};

/**
 * Endpoints for buyers and riders. There are no accounts here: the unguessable order link is the
 * capability to view an order, and secrets derived on the buyer's device authorise everything else.
 */
export async function publicRoutes(app: FastifyInstance) {
  const { ctx } = app;

  app.get("/public/orders/:publicId", async (req, reply) => {
    const order = await getOrderByPublicId(ctx, idOf(req));
    reply.header("Cache-Control", "no-store");
    return presentPublicOrder(ctx, order, { buyerKey: buyerKeyOf(req) });
  });

  // Each checkout asks the seller's wallet for an invoice, so it is limited more tightly.
  app.post("/public/orders/:publicId/checkout", { config: { rateLimit: { max: 12, timeWindow: "5 minutes" } } }, async (req) => {
    const body = CheckoutBody.parse(req.body);
    const { order } = await checkout(ctx, idOf(req), body.payment_hash, body.buyer_key_hash);
    return presentPublicOrder(ctx, order, { includePayment: true });
  });

  // Guessing a 256-bit preimage is hopeless, but there is no reason to let anyone try quickly.
  app.post("/public/orders/:publicId/release", { config: { rateLimit: { max: 20, timeWindow: "5 minutes" } } }, async (req, reply) => {
    const body = ReleaseBody.parse(req.body);
    const order = await release(ctx, idOf(req), body.preimage);
    // 202: the release is recorded and will complete, but the wallet has not confirmed yet.
    return reply.status(order.status === "completed" ? 200 : 202).send(await presentPublicOrder(ctx, order));
  });

  app.post("/public/orders/:publicId/cancel", async (req) => {
    const body = CancelBody.parse(req.body);
    const order = await buyerCancel(ctx, idOf(req), body.buyer_key);
    return presentPublicOrder(ctx, order, { buyerKey: body.buyer_key });
  });

  app.post("/public/orders/:publicId/rating", async (req) => {
    const body = RatingBody.parse(req.body);
    const order = await rateOrder(ctx, idOf(req), body.buyer_key, body.stars, body.review ?? null);
    return presentPublicOrder(ctx, order, { buyerKey: body.buyer_key });
  });

  app.get("/public/shops/:slug", async (req, reply) => {
    const slug = z.string().regex(/^[a-z0-9-]{2,48}$/).safeParse((req.params as { slug: string }).slug);
    if (!slug.success) throw notFound("Shop");
    const [seller] = await ctx.sql<{ id: string }[]>`select id from sellers where shop_slug = ${slug.data}`;
    if (!seller) throw notFound("Shop");
    const reviews = await ctx.sql<{ rating: number; review: string | null; rated_at: Date; total_xof: number }[]>`
      select rating, review, rated_at, total_xof from orders
      where seller_id = ${seller.id} and rating is not null order by rated_at desc limit 20`;
    const receipts = await ctx.sql<{ public_id: string; completed_at: Date; total_xof: number; receipt_event_id: string | null }[]>`
      select public_id, completed_at, total_xof, receipt_event_id from orders
      where seller_id = ${seller.id} and status = 'completed' order by completed_at desc limit 20`;
    reply.header("Cache-Control", "public, max-age=30");
    return {
      shop: await shopSummary(ctx.sql, seller.id),
      reviews: reviews.map((r) => ({ stars: r.rating, review: r.review, at: r.rated_at.toISOString(), total_xof: r.total_xof })),
      // Order ids are shortened: a receipt proves a delivery happened without exposing the order link.
      receipts: receipts.map((r) => ({
        ref: r.public_id.slice(0, 4),
        at: r.completed_at.toISOString(),
        total_xof: r.total_xof,
        event_id: r.receipt_event_id,
      })),
      nostr_npub: platformNpub(ctx),
    };
  });

  app.get("/public/rate", async (_req, reply) => {
    const rate = await ctx.rates.get();
    reply.header("Cache-Control", "public, max-age=30");
    return { xof_per_btc: rate.xofPerBtc, as_of: rate.asOf.toISOString(), sources: rate.sources };
  });

  app.get("/images/:id", async (req, reply) => {
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    if (!id.success) throw notFound("Photo");
    const [img] = await ctx.sql<{ mime: string; bytes: Buffer }[]>`select mime, bytes from images where id = ${id.data}`;
    if (!img) throw notFound("Photo");
    return reply
      .header("Content-Type", img.mime)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(img.bytes);
  });
}
