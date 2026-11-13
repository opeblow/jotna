import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { draftListing } from "../../domain/ai.js";
import { withIdempotency } from "../../domain/idempotency.js";
import {
  createOrder,
  getSellerOrder,
  markDispatched,
  presentSellerOrder,
  sellerCancel,
  type OrderRow,
} from "../../domain/orders.js";
import { badRequest, notFound } from "../../lib/errors.js";

const uuid = z.string().uuid();

const CreateOrderBody = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  amount_xof: z.number().int().positive(),
  delivery_fee_xof: z.number().int().min(0).default(0),
  customer_label: z.string().trim().max(60).optional().nullable(),
  delivery_window_minutes: z.number().int().min(30).max(1200).optional(),
  image_id: uuid.optional().nullable(),
});

const WalletBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("nwc"), connection_uri: z.string().min(20).max(2000) }),
  z.object({
    kind: z.literal("lnd"),
    rest_url: z.string().url().max(300),
    macaroon_hex: z.string().min(20).max(4000),
    tls_cert_pem: z.string().max(8000).optional(),
  }),
]);

const ListQuery = z.object({
  status: z.enum(["active", "done", "all"]).default("all"),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const AiBody = z.object({
  text: z.string().max(1000).default(""),
  image: z
    .object({ media_type: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(700_000) })
    .optional(),
});

const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_IMAGE_BYTES = 400 * 1024;

export async function sellerRoutes(app: FastifyInstance) {
  const { ctx } = app;

  // ---- Wallet ---------------------------------------------------------------------------------

  app.put("/wallet", { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } }, async (req) => {
    const seller = await app.requireSeller(req);
    const row = await ctx.wallets.connect(seller.id, WalletBody.parse(req.body));
    return { kind: row.kind, alias: row.alias, network: row.network, healthy: true };
  });

  app.post("/wallet/check", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const seller = await app.requireSeller(req);
    return ctx.wallets.check(seller.id);
  });

  app.delete("/wallet", async (req) => {
    const seller = await app.requireSeller(req);
    await ctx.wallets.disconnect(seller.id);
    return { ok: true };
  });

  // ---- Orders ---------------------------------------------------------------------------------

  app.post("/orders", async (req, reply) => {
    const seller = await app.requireSeller(req);
    const body = CreateOrderBody.parse(req.body);
    const result = await withIdempotency(
      ctx.sql,
      `seller:${seller.id}:create_order`,
      req.headers["idempotency-key"] as string | undefined,
      body,
      async () => ({ status: 201, body: await presentSellerOrder(ctx, await createOrder(ctx, seller.id, body)) }),
    );
    if (result.replayed) reply.header("Idempotent-Replayed", "true");
    return reply.status(result.status).send(result.body);
  });

  app.get("/orders", async (req) => {
    const seller = await app.requireSeller(req);
    const q = ListQuery.parse(req.query);
    const statuses =
      q.status === "active"
        ? ["open", "awaiting_payment", "funded", "settling", "refunding"]
        : q.status === "done"
          ? ["completed", "refunded", "cancelled"]
          : null;
    const rows = await ctx.sql<OrderRow[]>`
      select * from orders
      where seller_id = ${seller.id}
        ${statuses ? ctx.sql`and status in ${ctx.sql(statuses)}` : ctx.sql``}
        ${q.before ? ctx.sql`and created_at < ${q.before}` : ctx.sql``}
      order by created_at desc limit ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    return {
      orders: await Promise.all(page.map((o) => presentSellerOrder(ctx, o))),
      next_before: rows.length > q.limit ? page[page.length - 1]!.created_at.toISOString() : null,
    };
  });

  app.get("/orders/:id", async (req) => {
    const seller = await app.requireSeller(req);
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw notFound("Order");
    return presentSellerOrder(ctx, await getSellerOrder(ctx, seller.id, id.data), { withEvents: true });
  });

  app.post("/orders/:id/dispatch", async (req) => {
    const seller = await app.requireSeller(req);
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw notFound("Order");
    return presentSellerOrder(ctx, await markDispatched(ctx, seller.id, id.data), { withEvents: true });
  });

  app.post("/orders/:id/cancel", async (req) => {
    const seller = await app.requireSeller(req);
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) throw notFound("Order");
    return presentSellerOrder(ctx, await sellerCancel(ctx, seller.id, id.data), { withEvents: true });
  });

  app.get("/stats", async (req) => {
    const seller = await app.requireSeller(req);
    const [row] = await ctx.sql<
      { waiting: number; locked: number; locked_xof: number; delivered_7d: number; delivered_7d_xof: number; delivered_total: number }[]
    >`
      select
        count(*) filter (where status in ('open','awaiting_payment'))::int as waiting,
        count(*) filter (where status in ('funded','settling'))::int as locked,
        coalesce(sum(total_xof) filter (where status in ('funded','settling')), 0)::int as locked_xof,
        count(*) filter (where status = 'completed' and completed_at > now() - interval '7 days')::int as delivered_7d,
        coalesce(sum(total_xof) filter (where status = 'completed' and completed_at > now() - interval '7 days'), 0)::int as delivered_7d_xof,
        count(*) filter (where status = 'completed')::int as delivered_total
      from orders where seller_id = ${seller.id}`;
    return row;
  });

  // ---- Photos ---------------------------------------------------------------------------------

  await app.register(async (scope) => {
    for (const type of IMAGE_TYPES) {
      scope.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_req, body, done) => done(null, body));
    }
    scope.post("/images", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const seller = await app.requireSeller(req);
      const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
      const body = req.body as Buffer;
      if (!IMAGE_TYPES.includes(mime) || !Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest("invalid_image", "Send a JPEG, PNG or WebP photo");
      }
      if (!matchesMagic(mime, body)) throw badRequest("invalid_image", "That file is not a valid photo");
      const [row] = await ctx.sql<{ id: string }[]>`
        insert into images (seller_id, mime, bytes) values (${seller.id}, ${mime}, ${body}) returning id`;
      return reply.status(201).send({ id: row!.id, url: `/api/v1/images/${row!.id}` });
    });
  });

  // ---- Writing assistant ----------------------------------------------------------------------

  app.post("/ai/listing", { bodyLimit: 800 * 1024, config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } }, async (req) => {
    await app.requireSeller(req);
    const body = AiBody.parse(req.body);
    if (!body.text.trim() && !body.image) throw badRequest("empty_request", "Write a short note or add a photo");
    return draftListing(ctx, body);
  });
}

/** Trust the bytes, not the header: check the file signature before storing an upload. */
function matchesMagic(mime: string, b: Buffer): boolean {
  if (mime === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}
