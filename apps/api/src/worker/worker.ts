import type { AppContext } from "../context.js";
import { auditFundedOrder, finalizeRefund, finalizeSettlement, refundOrder, syncAttempt } from "../domain/orders.js";
import { msatToSats } from "../lib/money.js";
import { buildRating, buildReceipt, publish, sign } from "../nostr/publisher.js";

const TICK_MS = 2000;
const BATCH = 25;
const MAX_OUTBOX_ATTEMPTS = 8;

/**
 * Background reconciliation. Each job claims rows with `FOR UPDATE SKIP LOCKED` and pushes their
 * next-run time forward in the same statement, so several instances can run side by side without
 * doing the same work twice, and a crashed instance's rows become due again on their own.
 */
export function startWorker(ctx: AppContext): { stop: () => Promise<void> } {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let lastAudit = 0;
  let lastCleanup = 0;

  const safely = async (name: string, job: () => Promise<void>) => {
    try {
      await job();
    } catch (err) {
      ctx.log.error({ job: name, err: (err as Error).message }, "worker job failed");
    }
  };

  const each = (name: string, ids: string[], fn: (id: string) => Promise<unknown>) =>
    Promise.all(ids.map((id) => safely(`${name}:${id}`, async () => void (await fn(id)))));

  /** Watch unpaid invoices: detect locked payments and expire stale checkouts. */
  async function pollPendingPayments() {
    const rows = await ctx.sql<{ id: string }[]>`
      update payment_attempts set next_check_at = now() + interval '3 seconds'
      where id in (
        select id from payment_attempts where status = 'pending' and next_check_at <= now()
        order by next_check_at limit ${BATCH} for update skip locked)
      returning id`;
    await each("sync", rows.map((r) => r.id), (id) => syncAttempt(ctx, id));
  }

  /** Give the money back when the delivery window closes without a release. */
  async function enforceDeadlines() {
    const rows = await ctx.sql<{ id: string }[]>`
      select id from orders where status = 'funded' and deadline_at <= now() order by deadline_at limit ${BATCH}`;
    await each("deadline", rows.map((r) => r.id), (id) =>
      refundOrder(ctx, id, "deadline_passed", "system", { requireDeadlinePassed: true }),
    );
  }

  /** Finish settlements and refunds that were interrupted between the database and the wallet. */
  async function retryInterrupted() {
    const rows = await ctx.sql<{ id: string; status: string }[]>`
      update orders set retry_at = now() + interval '20 seconds'
      where id in (
        select id from orders where status in ('settling','refunding') and retry_at <= now()
        order by retry_at limit ${BATCH} for update skip locked)
      returning id, status`;
    await Promise.all(
      rows.map((r) =>
        safely(`retry:${r.id}`, () => (r.status === "settling" ? finalizeSettlement(ctx, r.id) : finalizeRefund(ctx, r.id))),
      ),
    );
  }

  /** Catch locks that the node released on its own (HTLC timeout) while we believed them held. */
  async function auditFunded() {
    const rows = await ctx.sql<{ id: string }[]>`select id from orders where status = 'funded' order by funded_at limit 100`;
    await each("audit", rows.map((r) => r.id), (id) => auditFundedOrder(ctx, id));
  }

  async function drainOutbox() {
    const rows = await ctx.sql<{ id: string; topic: string; payload: { order_id: string }; attempts: number }[]>`
      update outbox set attempts = attempts + 1,
                        next_attempt_at = now() + make_interval(secs => least(3600, 15 * power(2, attempts)))
      where id in (
        select id from outbox where status = 'pending' and next_attempt_at <= now()
        order by next_attempt_at limit 10 for update skip locked)
      returning id, topic, payload, attempts`;
    for (const row of rows) {
      try {
        await handleOutbox(row.topic, row.payload);
        await ctx.sql`update outbox set status = 'done', last_error = null where id = ${row.id}`;
      } catch (err) {
        const dead = row.attempts >= MAX_OUTBOX_ATTEMPTS;
        await ctx.sql`
          update outbox set status = ${dead ? "dead" : "pending"}, last_error = ${(err as Error).message.slice(0, 300)}
          where id = ${row.id}`;
        ctx.log.warn({ outboxId: row.id, topic: row.topic, dead, err: (err as Error).message }, "outbox delivery failed");
      }
    }
  }

  async function handleOutbox(topic: string, payload: { order_id: string }) {
    if (ctx.config.nostrRelays.length === 0 || !ctx.config.NOSTR_SECRET_KEY) return;
    const [o] = await ctx.sql<
      {
        public_id: string; shop_slug: string; total_xof: number; completed_at: Date; rating: number | null; review: string | null;
        rated_at: Date | null; payment_hash: string; preimage: string | null; amount_msat: string;
      }[]
    >`
      select o.public_id, s.shop_slug, o.total_xof, o.completed_at, o.rating, o.review, o.rated_at,
             a.payment_hash, a.preimage, a.amount_msat
      from orders o join sellers s on s.id = o.seller_id
      join payment_attempts a on a.order_id = o.id and a.status = 'settled'
      where o.id = ${payload.order_id}`;
    if (!o) return;

    if (topic === "nostr.receipt" && o.preimage) {
      const event = sign(ctx, buildReceipt({
        publicId: o.public_id, shopSlug: o.shop_slug, totalXof: o.total_xof, amountSats: msatToSats(o.amount_msat),
        paymentHash: o.payment_hash, preimage: o.preimage, completedAt: o.completed_at,
      }));
      await publish(ctx, event);
      await ctx.sql`update orders set receipt_event_id = ${event.id} where id = ${payload.order_id}`;
    } else if (topic === "nostr.rating" && o.rating && o.rated_at) {
      await publish(ctx, sign(ctx, buildRating({
        publicId: o.public_id, shopSlug: o.shop_slug, stars: o.rating, review: o.review, ratedAt: o.rated_at,
      })));
    }
  }

  async function cleanup() {
    await ctx.sql`delete from sessions where expires_at < now()`;
    await ctx.sql`delete from idempotency_keys where created_at < now() - interval '48 hours'`;
    await ctx.sql`delete from outbox where status = 'done' and created_at < now() - interval '7 days'`;
  }

  async function tick() {
    await safely("pollPendingPayments", pollPendingPayments);
    await safely("enforceDeadlines", enforceDeadlines);
    await safely("retryInterrupted", retryInterrupted);
    await safely("drainOutbox", drainOutbox);
    if (Date.now() - lastAudit > 60_000) {
      lastAudit = Date.now();
      await safely("auditFunded", auditFunded);
    }
    if (Date.now() - lastCleanup > 3_600_000) {
      lastCleanup = Date.now();
      await safely("cleanup", cleanup);
    }
  }

  const loop = async () => {
    while (!stopped) {
      const started = Date.now();
      await tick();
      const wait = Math.max(200, TICK_MS - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
    }
  };
  running = loop();
  ctx.log.info("worker started");

  return {
    stop: async () => {
      stopped = true;
      await running;
    },
  };
}
