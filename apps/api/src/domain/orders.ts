import type { AppContext } from "../context.js";
import type { Db, Tx } from "../db/client.js";
import { isHex64, randomPublicId, safeEqualHex, sha256Hex } from "../lib/crypto.js";
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { msatToSats, xofToMsat } from "../lib/money.js";
import { WalletError } from "../lightning/provider.js";

/**
 * Order lifecycle
 *
 *   open ──checkout──▶ awaiting_payment ──HTLC held──▶ funded ──release──▶ settling ──▶ completed
 *     ▲                      │ invoice expired              │ cancel / deadline
 *     └──────────────────────┘                              ▼
 *   open | awaiting_payment ──seller cancel──▶ cancelled  refunding ──▶ refunded
 *
 * `settling` and `refunding` are write-ahead states: the intent is committed to the database before
 * the wallet is called, so a crash between the two is finished by the worker instead of being lost.
 * Every wallet call used here is idempotent, which is what makes that retry safe.
 */
export type OrderStatus =
  | "open" | "awaiting_payment" | "funded" | "settling" | "completed" | "refunding" | "refunded" | "cancelled";

export interface OrderRow {
  id: string;
  public_id: string;
  seller_id: string;
  title: string;
  description: string | null;
  image_id: string | null;
  customer_label: string | null;
  amount_xof: number;
  delivery_fee_xof: number;
  total_xof: number;
  delivery_window_minutes: number;
  status: OrderStatus;
  close_reason: string | null;
  buyer_key_hash: string | null;
  funded_at: Date | null;
  deadline_at: Date | null;
  dispatched_at: Date | null;
  completed_at: Date | null;
  closed_at: Date | null;
  rating: number | null;
  review: string | null;
  rated_at: Date | null;
  receipt_event_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AttemptRow {
  id: string;
  order_id: string;
  payment_hash: string;
  buyer_key_hash: string | null;
  preimage: string | null;
  bolt11: string;
  amount_msat: string;
  xof_per_btc: string;
  status: "pending" | "held" | "settled" | "cancelled" | "expired";
  invoice_expires_at: Date;
  held_at: Date | null;
  settled_at: Date | null;
  created_at: Date;
}

type Actor = "seller" | "buyer" | "system";

/** Keep a margin before the node's own HTLC timeout so a release never races the chain. */
const SETTLE_MARGIN_MS = 30 * 60_000;

async function addEvent(db: Db, orderId: string, type: string, actor: Actor, data: Record<string, unknown> = {}) {
  await db`insert into order_events (order_id, type, actor, data) values (${orderId}, ${type}, ${actor}, ${db.json(data as never)})`;
}

const lockOrder = async (tx: Tx, orderId: string) =>
  (await tx<OrderRow[]>`select * from orders where id = ${orderId} for update`)[0];

const pendingAttempts = async (db: Db, orderId: string) =>
  db<AttemptRow[]>`select * from payment_attempts where order_id = ${orderId} and status = 'pending' order by created_at`;

/** The attempt that represents the order: the locked or settled one if there is one, else the newest. */
const latestAttempt = async (db: Db, orderId: string) =>
  (await db<AttemptRow[]>`
    select * from payment_attempts where order_id = ${orderId}
    order by (status in ('held','settled')) desc, created_at desc limit 1`)[0];

// ------------------------------------------------------------------------------------------------
// Seller side
// ------------------------------------------------------------------------------------------------

export interface CreateOrderInput {
  title: string;
  description?: string | null;
  amount_xof: number;
  delivery_fee_xof: number;
  customer_label?: string | null;
  delivery_window_minutes?: number;
  image_id?: string | null;
}

export async function createOrder(ctx: AppContext, sellerId: string, input: CreateOrderInput): Promise<OrderRow> {
  const total = input.amount_xof + input.delivery_fee_xof;
  if (total < ctx.config.MIN_ORDER_XOF || total > ctx.config.MAX_ORDER_XOF) {
    throw unprocessable("amount_out_of_range", `Total must be between ${ctx.config.MIN_ORDER_XOF} and ${ctx.config.MAX_ORDER_XOF} F CFA`, {
      min: ctx.config.MIN_ORDER_XOF,
      max: ctx.config.MAX_ORDER_XOF,
    });
  }
  const [wallet] = await ctx.sql`select 1 from wallets where seller_id = ${sellerId}`;
  if (!wallet) throw conflict("wallet_not_connected", "Connect a Lightning wallet before taking orders");
  if (input.image_id) {
    const [img] = await ctx.sql`select 1 from images where id = ${input.image_id} and seller_id = ${sellerId}`;
    if (!img) throw badRequest("invalid_image", "That photo does not exist");
  }
  return ctx.sql.begin(async (tx) => {
    const [order] = await tx<OrderRow[]>`
      insert into orders (public_id, seller_id, title, description, image_id, customer_label,
                          amount_xof, delivery_fee_xof, delivery_window_minutes)
      values (${randomPublicId()}, ${sellerId}, ${input.title}, ${input.description ?? null}, ${input.image_id ?? null},
              ${input.customer_label ?? null}, ${input.amount_xof}, ${input.delivery_fee_xof},
              ${input.delivery_window_minutes ?? ctx.config.DEFAULT_DELIVERY_WINDOW_MINUTES})
      returning *`;
    await addEvent(tx, order!.id, "created", "seller");
    return order!;
  });
}

export async function getSellerOrder(ctx: AppContext, sellerId: string, orderId: string): Promise<OrderRow> {
  const [order] = await ctx.sql<OrderRow[]>`select * from orders where id = ${orderId} and seller_id = ${sellerId}`;
  if (!order) throw notFound("Order");
  return order;
}

export async function markDispatched(ctx: AppContext, sellerId: string, orderId: string): Promise<OrderRow> {
  return ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || order.seller_id !== sellerId) throw notFound("Order");
    if (order.dispatched_at) return order; // idempotent
    if (order.status !== "funded") {
      throw conflict("not_funded", "Only send the rider once the payment is locked", { status: order.status });
    }
    const [updated] = await tx<OrderRow[]>`
      update orders set dispatched_at = now(), updated_at = now() where id = ${orderId} returning *`;
    await addEvent(tx, orderId, "dispatched", "seller");
    return updated!;
  });
}

/** Seller cancels: before payment the link is voided, after payment the buyer is refunded. */
export async function sellerCancel(ctx: AppContext, sellerId: string, orderId: string): Promise<OrderRow> {
  const order = await getSellerOrder(ctx, sellerId, orderId);
  if (order.status === "funded") return refundOrder(ctx, orderId, "seller_cancelled", "seller");
  if (["cancelled", "refunded", "refunding"].includes(order.status)) return order; // idempotent
  if (order.status === "awaiting_payment") {
    // A buyer may have paid a moment ago; learn the truth from the wallet before voiding.
    for (const attempt of await pendingAttempts(ctx.sql, orderId)) await syncAttempt(ctx, attempt.id).catch(() => {});
  }
  const result = await ctx.sql.begin(async (tx) => {
    const locked = await lockOrder(tx, orderId);
    if (!locked) throw notFound("Order");
    if (locked.status === "funded") return { order: locked, refund: true };
    if (locked.status !== "open" && locked.status !== "awaiting_payment") {
      throw conflict("not_cancellable", "This order can no longer be cancelled", { status: locked.status });
    }
    const [updated] = await tx<OrderRow[]>`
      update orders set status = 'cancelled', close_reason = 'seller_cancelled', closed_at = now(), updated_at = now()
      where id = ${orderId} returning *`;
    await addEvent(tx, orderId, "cancelled", "seller");
    return { order: updated!, refund: false };
  });
  if (result.refund) return refundOrder(ctx, orderId, "seller_cancelled", "seller");
  // Unpaid invoices are withdrawn at the wallet. Their rows stay "pending" on purpose: the worker
  // keeps checking each one until the wallet confirms it is gone, and gives the money straight back
  // if a payment slips in before the withdrawal lands.
  for (const attempt of await pendingAttempts(ctx.sql, orderId)) await voidInvoice(ctx, order.seller_id, attempt.payment_hash);
  return result.order;
}

// ------------------------------------------------------------------------------------------------
// Buyer side
// ------------------------------------------------------------------------------------------------

export async function getOrderByPublicId(ctx: AppContext, publicId: string): Promise<OrderRow> {
  const [order] = await ctx.sql<OrderRow[]>`select * from orders where public_id = ${publicId}`;
  if (!order) throw notFound("Order");
  return order;
}

const keyHashOf = (buyerKey: string | undefined | null) =>
  isHex64(buyerKey) ? sha256Hex(Buffer.from(buyerKey, "hex")) : null;

/** True when `buyerKey` belongs to the device whose payment is locked for this order. */
export const isBuyer = (order: OrderRow, buyerKey: string | undefined | null) => {
  const hash = keyHashOf(buyerKey);
  return Boolean(hash && order.buyer_key_hash && safeEqualHex(hash, order.buyer_key_hash));
};

/** Unpaid invoices allowed per order at once. Bounds what a stranger with the link can make the wallet do. */
const MAX_PENDING_ATTEMPTS = 6;
/** An unpaid invoice older than this may be withdrawn to make room for a new checkout. */
const EVICTABLE_AFTER_MS = 2 * 60_000;

/**
 * Start (or resume) paying for an order.
 *
 * The buyer's device invents a secret, keeps it, and sends only its hash. The seller's wallet issues
 * an invoice locked to that hash, so the money can only be claimed by revealing the secret.
 * Calling again with the same hash returns the same invoice.
 *
 * Several devices may check out the same order at once. Each gets its own invoice; the first
 * payment to lock wins and the rest are withdrawn (see syncAttempt). That is deliberate: if only one
 * checkout were allowed, anyone who saw the link could open it and shut the real buyer out.
 */
export async function checkout(
  ctx: AppContext,
  publicId: string,
  paymentHash: string,
  buyerKeyHash: string,
): Promise<{ order: OrderRow; attempt: AttemptRow }> {
  const order = await getOrderByPublicId(ctx, publicId);
  if (order.status !== "open" && order.status !== "awaiting_payment") {
    throw conflict("order_not_payable", "This order can no longer be paid", { status: order.status });
  }

  // A payment hash identifies exactly one attempt, ever. Refuse a reused hash before asking the
  // wallet for anything: the hash of someone else's in-flight payment is visible to routing nodes,
  // and we must never create, or later cancel, an invoice on the strength of a borrowed hash.
  const [existing] = await ctx.sql<AttemptRow[]>`select * from payment_attempts where payment_hash = ${paymentHash}`;
  if (existing) {
    if (existing.order_id === order.id && existing.status === "pending" && existing.buyer_key_hash === buyerKeyHash) {
      return { order, attempt: existing }; // the same device asking again
    }
    throw conflict("payment_hash_reused", "This payment code was already used. Start the payment again.");
  }

  const pending = await pendingAttempts(ctx.sql, order.id);
  if (pending.length >= MAX_PENDING_ATTEMPTS) {
    const oldest = pending[0]!;
    const age = Date.now() - oldest.created_at.getTime();
    if (age < EVICTABLE_AFTER_MS) {
      throw conflict("checkout_in_progress", "Too many payments are open for this order. Try again in a minute.", {
        retry_after_seconds: Math.ceil((EVICTABLE_AFTER_MS - age) / 1000),
      });
    }
    await evictAttempt(ctx, order.seller_id, oldest);
  }

  const rate = await ctx.rates.get();
  const amountMsat = xofToMsat(order.total_xof, rate.xofPerBtc);
  const provider = await ctx.wallets.forSeller(order.seller_id);
  const expirySeconds = ctx.config.INVOICE_EXPIRY_SECONDS;

  // The wallet call happens outside any transaction. If we lose the race below, or crash here, the
  // invoice is an orphan nobody was ever shown: it cannot be paid by a buyer and simply expires.
  let bolt11: string;
  try {
    ({ bolt11 } = await provider.createHoldInvoice({
      paymentHash,
      amountMsat,
      description: `Jotna ${order.public_id}`,
      expirySeconds,
      cltvDelta: ctx.config.HOLD_CLTV_DELTA,
    }));
  } catch (err) {
    if (err instanceof WalletError) {
      ctx.log.warn({ orderId: order.id, err: err.message }, "hold invoice creation failed");
      throw new AppError(502, "wallet_unavailable", "The seller's wallet did not answer. Try again in a moment.");
    }
    throw err;
  }

  try {
    return await ctx.sql.begin(async (tx) => {
      const locked = await lockOrder(tx, order.id);
      if (!locked || (locked.status !== "open" && locked.status !== "awaiting_payment")) {
        throw conflict("order_not_payable", "This order can no longer be paid", { status: locked?.status });
      }
      const [attempt] = await tx<AttemptRow[]>`
        insert into payment_attempts (order_id, payment_hash, buyer_key_hash, bolt11, amount_msat, xof_per_btc, invoice_expires_at)
        values (${order.id}, ${paymentHash}, ${buyerKeyHash}, ${bolt11}, ${amountMsat.toString()}, ${rate.xofPerBtc},
                now() + make_interval(secs => ${expirySeconds}))
        returning *`;
      if (locked.status === "awaiting_payment") return { order: locked, attempt: attempt! };
      const [updated] = await tx<OrderRow[]>`
        update orders set status = 'awaiting_payment', updated_at = now() where id = ${order.id} returning *`;
      await addEvent(tx, order.id, "checkout_started", "buyer", { amount_sats: msatToSats(amountMsat) });
      return { order: updated!, attempt: attempt! };
    });
  } catch (err) {
    const pg = err as { code?: string; constraint_name?: string };
    if (pg.code === "23505" && pg.constraint_name === "payment_attempts_payment_hash_key") {
      // Lost a race with another request using the same hash. The invoice under this hash is that
      // attempt's invoice now, so it must not be cancelled from here.
      throw conflict("payment_hash_reused", "This payment code was already used. Start the payment again.");
    }
    await provider.cancel(paymentHash).catch(() => {});
    throw err;
  }
}

/** Withdraw the oldest unpaid invoice to make room, unless it turns out to have just been paid. */
async function evictAttempt(ctx: AppContext, sellerId: string, attempt: AttemptRow): Promise<void> {
  await syncAttempt(ctx, attempt.id).catch(() => {});
  const [still] = await ctx.sql`select 1 from payment_attempts where id = ${attempt.id} and status = 'pending'`;
  if (!still) return;
  try {
    const provider = await ctx.wallets.forSeller(sellerId);
    await provider.cancel(attempt.payment_hash);
  } catch (err) {
    if (!(err instanceof WalletError)) throw err;
    // Only forget an invoice once the wallet has confirmed it can no longer be paid.
    throw new AppError(502, "wallet_unavailable", "The seller's wallet did not answer. Try again in a moment.");
  }
  await ctx.sql`update payment_attempts set status = 'cancelled', closed_at = now() where id = ${attempt.id} and status = 'pending'`;
}

/**
 * Reconcile one payment attempt with the seller's wallet, which is the source of truth for whether
 * money is locked. Called by the worker on a schedule and inline before decisions that depend on it.
 */
export async function syncAttempt(ctx: AppContext, attemptId: string): Promise<void> {
  const [attempt] = await ctx.sql<(AttemptRow & { seller_id: string })[]>`
    select a.*, o.seller_id from payment_attempts a join orders o on o.id = a.order_id where a.id = ${attemptId}`;
  if (!attempt || attempt.status !== "pending") return;

  const provider = await ctx.wallets.forSeller(attempt.seller_id);
  const invoice = await provider.lookupInvoice(attempt.payment_hash);

  if (invoice.state === "settled") {
    await recordSettledOutside(ctx, attempt.order_id, attempt.id);
    return;
  }

  if (invoice.state === "held") {
    const outcome = await ctx.sql.begin(async (tx) => {
      const order = await lockOrder(tx, attempt.order_id);
      const [fresh] = await tx<AttemptRow[]>`select * from payment_attempts where id = ${attemptId} for update`;
      if (!order || !fresh || fresh.status !== "pending") return "noop" as const;
      if (order.status !== "awaiting_payment") return "stray" as const;
      const windowEnd = Date.now() + order.delivery_window_minutes * 60_000;
      const nodeEnd = invoice.settleDeadline ? invoice.settleDeadline.getTime() - SETTLE_MARGIN_MS : Infinity;
      const deadline = new Date(Math.min(windowEnd, nodeEnd));
      await tx`update payment_attempts set status = 'held', held_at = now() where id = ${attemptId}`;
      await tx`update orders set status = 'funded', buyer_key_hash = ${fresh.buyer_key_hash}, funded_at = now(),
               deadline_at = ${deadline}, updated_at = now() where id = ${order.id}`;
      await addEvent(tx, order.id, "funded", "system", { amount_sats: msatToSats(attempt.amount_msat) });
      return "funded" as const;
    });
    if (outcome === "stray") {
      // Money arrived for an order that was cancelled, or that another device paid first: give it
      // straight back. The row stays "pending" so the worker retries until the wallet confirms.
      await provider.cancel(attempt.payment_hash).catch(() => {});
    }
    if (outcome === "funded") {
      // First payment to lock wins. Withdraw every other unpaid invoice for this order; their rows
      // also stay "pending" until the wallet confirms, so a late payment is caught and returned.
      for (const loser of await pendingAttempts(ctx.sql, attempt.order_id)) {
        await provider.cancel(loser.payment_hash).catch(() => {});
      }
    }
    return;
  }

  const expired = attempt.invoice_expires_at.getTime() <= Date.now();
  if (invoice.state === "cancelled" || expired) {
    if (invoice.state !== "cancelled") await provider.cancel(attempt.payment_hash).catch(() => {});
    await ctx.sql.begin(async (tx) => {
      const order = await lockOrder(tx, attempt.order_id);
      const [closed] = await tx`
        update payment_attempts set status = 'expired', closed_at = now()
        where id = ${attemptId} and status = 'pending' returning id`;
      if (!closed || !order || order.status !== "awaiting_payment") return;
      // The order is payable again only when no other device still has an unpaid invoice.
      const [reopened] = await tx`
        update orders set status = 'open', updated_at = now()
        where id = ${order.id}
          and not exists (select 1 from payment_attempts where order_id = ${order.id} and status = 'pending')
        returning id`;
      if (reopened) await addEvent(tx, order.id, "checkout_expired", "system");
    });
  }
}

/**
 * Release the locked payment to the seller. `preimage` is the buyer's secret, revealed at the door.
 * Safe to call repeatedly: the same preimage always leads to the same outcome.
 */
export async function release(ctx: AppContext, publicId: string, preimage: string): Promise<OrderRow> {
  const order = await getOrderByPublicId(ctx, publicId);
  const paymentHash = sha256Hex(Buffer.from(preimage, "hex"));
  const [attempt] = await ctx.sql<AttemptRow[]>`
    select * from payment_attempts where order_id = ${order.id} and payment_hash = ${paymentHash}`;
  if (!attempt) throw unprocessable("wrong_code", "That code does not match this order");

  if (attempt.status === "pending") {
    await syncAttempt(ctx, attempt.id).catch((err) => {
      if (!(err instanceof WalletError)) throw err;
    });
  }

  const ready = await ctx.sql.begin(async (tx) => {
    const locked = (await lockOrder(tx, order.id))!;
    const [fresh] = await tx<AttemptRow[]>`select * from payment_attempts where id = ${attempt.id} for update`;
    if (locked.status === "completed" && fresh!.status === "settled") return false;
    if (locked.status === "settling" && fresh!.status === "held") return true;
    if (locked.status !== "funded" || fresh!.status !== "held") {
      throw conflict("not_releasable", releaseRefusal(locked.status), { status: locked.status });
    }
    await tx`update payment_attempts set preimage = ${preimage} where id = ${attempt.id}`;
    await tx`update orders set status = 'settling', retry_at = now() + interval '20 seconds', updated_at = now()
             where id = ${order.id}`;
    await addEvent(tx, order.id, "release_requested", "buyer");
    return true;
  });

  if (ready) await finalizeSettlement(ctx, order.id);
  return getOrderByPublicId(ctx, publicId);
}

function releaseRefusal(status: OrderStatus): string {
  switch (status) {
    case "open":
    case "awaiting_payment":
      return "This order has not been paid yet";
    case "refunding":
    case "refunded":
      return "This order was cancelled and the money returned to the buyer";
    case "cancelled":
      return "This order was cancelled";
    default:
      return "This order cannot be released";
  }
}

/** Buyer changes their mind. Allowed until the seller has sent the rider. */
export async function buyerCancel(ctx: AppContext, publicId: string, buyerKey: string): Promise<OrderRow> {
  const order = await getOrderByPublicId(ctx, publicId);
  if (!isBuyer(order, buyerKey)) throw forbidden("not_buyer", "Only the device that paid can cancel this order");
  if (order.status === "refunding" || order.status === "refunded") return order;
  if (order.status !== "funded") throw conflict("not_cancellable", "This order cannot be cancelled now", { status: order.status });
  return refundOrder(ctx, order.id, "buyer_cancelled", "buyer", { buyerGraceMs: ctx.config.DISPATCH_GRACE_MINUTES * 60_000 });
}

/**
 * When the buyer may cancel a dispatched order. The buyer can always cancel before the rider leaves.
 * Once the seller says the rider has left, cancelling is paused so a parcel in transit is not
 * orphaned, but only for a while: a seller cannot hold a buyer's money by clicking "dispatched"
 * and then never delivering.
 */
export const buyerCancelAvailableAt = (order: OrderRow, graceMinutes: number): Date | null =>
  order.dispatched_at ? new Date(order.dispatched_at.getTime() + graceMinutes * 60_000) : null;

export async function rateOrder(
  ctx: AppContext,
  publicId: string,
  buyerKey: string,
  stars: number,
  review: string | null,
): Promise<OrderRow> {
  const order = await getOrderByPublicId(ctx, publicId);
  if (!isBuyer(order, buyerKey)) throw forbidden("not_buyer", "Only the buyer can rate this order");
  if (order.status !== "completed") throw conflict("not_completed", "You can rate once the order is delivered");
  if (order.rating) return order;
  return ctx.sql.begin(async (tx) => {
    const [updated] = await tx<OrderRow[]>`
      update orders set rating = ${stars}, review = ${review}, rated_at = now(), updated_at = now()
      where id = ${order.id} and rating is null returning *`;
    if (!updated) return (await lockOrder(tx, order.id))!;
    await addEvent(tx, order.id, "rated", "buyer", { stars });
    if (ctx.config.nostrRelays.length > 0) {
      await tx`insert into outbox (topic, payload) values ('nostr.rating', ${tx.json({ order_id: order.id })})`;
    }
    return updated;
  });
}

// ------------------------------------------------------------------------------------------------
// Settlement and refund: write-ahead state, then an idempotent wallet call, then the final state.
// ------------------------------------------------------------------------------------------------

export async function finalizeSettlement(ctx: AppContext, orderId: string): Promise<void> {
  const [row] = await ctx.sql<(AttemptRow & { seller_id: string; order_status: OrderStatus })[]>`
    select a.*, o.seller_id, o.status as order_status
    from orders o join payment_attempts a on a.order_id = o.id and a.status = 'held'
    where o.id = ${orderId}`;
  if (!row || row.order_status !== "settling" || !row.preimage) return;

  const provider = await ctx.wallets.forSeller(row.seller_id);
  try {
    await provider.settle(row.preimage);
  } catch (err) {
    if (!(err instanceof WalletError)) throw err;
    // The call failed, but did it take effect? Ask the wallet before deciding anything.
    const state = await provider.lookupInvoice(row.payment_hash).then((i) => i.state).catch(() => null);
    if (state === "cancelled") {
      // The node already gave the money back (HTLC timed out). Record the truth.
      await ctx.sql.begin(async (tx) => {
        const order = await lockOrder(tx, orderId);
        if (order?.status !== "settling") return;
        await tx`update payment_attempts set status = 'cancelled', closed_at = now() where id = ${row.id}`;
        await tx`update orders set status = 'refunded', close_reason = 'lock_expired', closed_at = now(), updated_at = now()
                 where id = ${orderId}`;
        await addEvent(tx, orderId, "refunded", "system", { reason: "lock_expired" });
      });
      return;
    }
    if (state !== "settled") {
      ctx.log.warn({ orderId, err: err.message }, "settle failed, the worker will retry");
      return;
    }
  }

  await ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order?.status !== "settling") return;
    await tx`update payment_attempts set status = 'settled', settled_at = now() where id = ${row.id}`;
    await tx`update orders set status = 'completed', completed_at = now(), closed_at = now(), retry_at = null, updated_at = now()
             where id = ${orderId}`;
    await addEvent(tx, orderId, "completed", "system");
    if (ctx.config.nostrRelays.length > 0) {
      await tx`insert into outbox (topic, payload) values ('nostr.receipt', ${tx.json({ order_id: orderId })})`;
    }
  });
}

export async function refundOrder(
  ctx: AppContext,
  orderId: string,
  reason: "seller_cancelled" | "buyer_cancelled" | "deadline_passed",
  actor: Actor,
  opts: { buyerGraceMs?: number; requireDeadlinePassed?: boolean } = {},
): Promise<OrderRow> {
  const moved = await ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order) throw notFound("Order");
    if (order.status === "refunding" || order.status === "refunded") return true;
    if (order.status !== "funded") {
      if (actor === "system") return false; // released or closed while we were deciding
      throw conflict("not_refundable", "This order cannot be refunded now", { status: order.status });
    }
    if (opts.buyerGraceMs !== undefined && order.dispatched_at) {
      const availableAt = order.dispatched_at.getTime() + opts.buyerGraceMs;
      if (Date.now() < availableAt) {
        throw conflict("already_dispatched", "The rider is on the way. If the parcel is not right, do not show your code.", {
          cancel_available_at: new Date(availableAt).toISOString(),
        });
      }
    }
    if (opts.requireDeadlinePassed && (!order.deadline_at || order.deadline_at.getTime() > Date.now())) return false;
    await tx`update orders set status = 'refunding', close_reason = ${reason}, retry_at = now() + interval '20 seconds',
             updated_at = now() where id = ${orderId}`;
    await addEvent(tx, orderId, "refund_requested", actor, { reason });
    return true;
  });
  if (moved) await finalizeRefund(ctx, orderId);
  const [order] = await ctx.sql<OrderRow[]>`select * from orders where id = ${orderId}`;
  return order!;
}

export async function finalizeRefund(ctx: AppContext, orderId: string): Promise<void> {
  const [row] = await ctx.sql<(AttemptRow & { seller_id: string; order_status: OrderStatus; close_reason: string | null })[]>`
    select a.*, o.seller_id, o.status as order_status, o.close_reason
    from orders o join payment_attempts a on a.order_id = o.id and a.status = 'held'
    where o.id = ${orderId}`;
  if (!row || row.order_status !== "refunding") return;

  const provider = await ctx.wallets.forSeller(row.seller_id);
  try {
    await provider.cancel(row.payment_hash);
  } catch (err) {
    if (!(err instanceof WalletError)) throw err;
    const state = await provider.lookupInvoice(row.payment_hash).then((i) => i.state).catch(() => null);
    if (state === "settled") {
      // The money is already with the seller, so there is nothing left to refund.
      await recordSettledOutside(ctx, orderId, row.id);
      return;
    }
    if (state !== "cancelled") {
      ctx.log.warn({ orderId, err: err.message }, "refund failed, the worker will retry");
      return;
    }
  }
  await ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order?.status !== "refunding") return;
    await tx`update payment_attempts set status = 'cancelled', closed_at = now() where id = ${row.id}`;
    await tx`update orders set status = 'refunded', closed_at = now(), retry_at = null, updated_at = now() where id = ${orderId}`;
    await addEvent(tx, orderId, "refunded", "system", { reason: row.close_reason });
  });
}

/** A funded order whose lock disappeared at the node (HTLC timed out) is recorded as refunded. */
export async function auditFundedOrder(ctx: AppContext, orderId: string): Promise<void> {
  const [row] = await ctx.sql<(AttemptRow & { seller_id: string })[]>`
    select a.*, o.seller_id from orders o join payment_attempts a on a.order_id = o.id and a.status = 'held'
    where o.id = ${orderId} and o.status = 'funded'`;
  if (!row) return;
  const provider = await ctx.wallets.forSeller(row.seller_id);
  const invoice = await provider.lookupInvoice(row.payment_hash);
  if (invoice.state === "settled") return recordSettledOutside(ctx, orderId, row.id);
  if (invoice.state === "held") {
    // Blocks can arrive faster than expected. If the node's own timeout has moved closer than our
    // deadline, bring the deadline forward so the refund is ours to announce, not a surprise.
    if (invoice.settleDeadline) {
      const nodeEnd = new Date(invoice.settleDeadline.getTime() - SETTLE_MARGIN_MS);
      await ctx.sql`update orders set deadline_at = ${nodeEnd}, updated_at = now()
                    where id = ${orderId} and status = 'funded' and deadline_at > ${nodeEnd}`;
    }
    return;
  }
  if (invoice.state !== "cancelled") return;
  await ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order?.status !== "funded") return;
    await tx`update payment_attempts set status = 'cancelled', closed_at = now() where id = ${row.id}`;
    await tx`update orders set status = 'refunded', close_reason = 'lock_expired', closed_at = now(), updated_at = now()
             where id = ${orderId}`;
    await addEvent(tx, orderId, "refunded", "system", { reason: "lock_expired" });
  });
}

/**
 * The seller's node reports the invoice as settled although Jotna never asked for it (the node was
 * operated by hand, or a previous settle call succeeded and its answer was lost). The payment is
 * final on the Lightning side, so the order is closed as completed. A public receipt is issued
 * only when the buyer's code was actually presented.
 */
async function recordSettledOutside(ctx: AppContext, orderId: string, attemptId: string): Promise<void> {
  await ctx.sql.begin(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || ["completed", "refunded", "cancelled"].includes(order.status)) return;
    const [closed] = await tx<AttemptRow[]>`
      update payment_attempts set status = 'settled', settled_at = now()
      where id = ${attemptId} and status in ('pending','held') returning *`;
    if (!closed) return;
    await tx`update orders set status = 'completed', completed_at = now(), closed_at = now(), close_reason = null,
             funded_at = coalesce(funded_at, now()), retry_at = null, updated_at = now() where id = ${orderId}`;
    await addEvent(tx, orderId, "completed", "system", { settled_outside: !closed.preimage });
    if (closed.preimage && ctx.config.nostrRelays.length > 0) {
      await tx`insert into outbox (topic, payload) values ('nostr.receipt', ${tx.json({ order_id: orderId })})`;
    }
  });
  ctx.log.warn({ orderId }, "invoice was settled outside the normal release path");
}

async function voidInvoice(ctx: AppContext, sellerId: string, paymentHash: string) {
  try {
    const provider = await ctx.wallets.forSeller(sellerId);
    await provider.cancel(paymentHash);
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, "could not void invoice; it will expire on its own");
  }
}

// ------------------------------------------------------------------------------------------------
// Read models
// ------------------------------------------------------------------------------------------------

export interface ShopSummary {
  name: string;
  slug: string;
  city: string | null;
  member_since: string;
  delivered_count: number;
  rating_count: number;
  rating_avg: number | null;
}

export async function shopSummary(db: Db, sellerId: string): Promise<ShopSummary> {
  const [row] = await db<
    { shop_name: string; shop_slug: string; city: string | null; created_at: Date; delivered: number; rated: number; avg: string | null }[]
  >`
    select s.shop_name, s.shop_slug, s.city, s.created_at,
           count(o.id) filter (where o.status = 'completed')::int as delivered,
           count(o.rating)::int as rated,
           round(avg(o.rating), 1)::text as avg
    from sellers s left join orders o on o.seller_id = s.id
    where s.id = ${sellerId} group by s.id`;
  return {
    name: row!.shop_name,
    slug: row!.shop_slug,
    city: row!.city,
    member_since: row!.created_at.toISOString(),
    delivered_count: row!.delivered,
    rating_count: row!.rated,
    rating_avg: row!.avg ? Number(row!.avg) : null,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** What anyone holding the order link may see. No seller notes, no payment secrets. */
export async function presentPublicOrder(ctx: AppContext, order: OrderRow, opts: { buyerKey?: string | null; attempt?: AttemptRow } = {}) {
  // Until a payment is locked, every unpaid attempt has its own buyer. Afterwards the order has one.
  const keyHash = keyHashOf(opts.buyerKey);
  const mine =
    opts.attempt ??
    (keyHash
      ? (await ctx.sql<AttemptRow[]>`
          select * from payment_attempts where order_id = ${order.id} and buyer_key_hash = ${keyHash}
          order by created_at desc limit 1`)[0]
      : undefined);
  const decided = order.buyer_key_hash !== null;
  const attempt = decided ? await latestAttempt(ctx.sql, order.id) : mine;
  const buyer = decided ? isBuyer(order, opts.buyerKey) : mine?.status === "pending";
  const showPayment = order.status === "awaiting_payment" && buyer && mine?.status === "pending";
  const cancelAt = buyerCancelAvailableAt(order, ctx.config.DISPATCH_GRACE_MINUTES);

  let quote: { amount_sats: number; xof_per_btc: number; as_of: string } | null = null;
  if (order.status === "open" || (order.status === "awaiting_payment" && !buyer)) {
    const rate = await ctx.rates.get().catch(() => null);
    if (rate) {
      quote = {
        amount_sats: msatToSats(xofToMsat(order.total_xof, rate.xofPerBtc)),
        xof_per_btc: rate.xofPerBtc,
        as_of: rate.asOf.toISOString(),
      };
    }
  }

  return {
    public_id: order.public_id,
    status: order.status,
    title: order.title,
    description: order.description,
    image_url: order.image_id ? `/api/v1/images/${order.image_id}` : null,
    amount_xof: order.amount_xof,
    delivery_fee_xof: order.delivery_fee_xof,
    total_xof: order.total_xof,
    delivery_window_minutes: order.delivery_window_minutes,
    shop: await shopSummary(ctx.sql, order.seller_id),
    quote,
    amount_sats: attempt && order.status !== "open" ? msatToSats(attempt.amount_msat) : null,
    payment: showPayment
      ? { bolt11: mine!.bolt11, amount_sats: msatToSats(mine!.amount_msat), expires_at: mine!.invoice_expires_at.toISOString() }
      : null,
    is_buyer: buyer,
    can_cancel: buyer && order.status === "funded" && (!cancelAt || cancelAt.getTime() <= Date.now()),
    cancel_available_at: order.status === "funded" ? iso(cancelAt) : null,
    funded_at: iso(order.funded_at),
    deadline_at: iso(order.deadline_at),
    dispatched_at: iso(order.dispatched_at),
    completed_at: iso(order.completed_at),
    closed_at: iso(order.closed_at),
    close_reason: order.close_reason,
    rating: order.rating,
    receipt_event_id: order.receipt_event_id,
    network: ctx.config.NETWORK,
    dev_pay_enabled: Boolean(ctx.config.DEV_BUYER_LND_URL),
    server_time: new Date().toISOString(),
  };
}

export async function presentSellerOrder(ctx: AppContext, order: OrderRow, opts: { withEvents?: boolean } = {}) {
  const attempt = await latestAttempt(ctx.sql, order.id);
  const events = opts.withEvents
    ? await ctx.sql<{ type: string; actor: string; data: Record<string, unknown>; created_at: Date }[]>`
        select type, actor, data, created_at from order_events where order_id = ${order.id} order by id`
    : undefined;
  return {
    id: order.id,
    public_id: order.public_id,
    share_url: `${ctx.config.WEB_ORIGIN}/o/${order.public_id}`,
    status: order.status,
    title: order.title,
    description: order.description,
    image_url: order.image_id ? `/api/v1/images/${order.image_id}` : null,
    customer_label: order.customer_label,
    amount_xof: order.amount_xof,
    delivery_fee_xof: order.delivery_fee_xof,
    total_xof: order.total_xof,
    delivery_window_minutes: order.delivery_window_minutes,
    amount_sats: attempt && order.status !== "open" ? msatToSats(attempt.amount_msat) : null,
    close_reason: order.close_reason,
    created_at: order.created_at.toISOString(),
    funded_at: iso(order.funded_at),
    deadline_at: iso(order.deadline_at),
    dispatched_at: iso(order.dispatched_at),
    completed_at: iso(order.completed_at),
    closed_at: iso(order.closed_at),
    rating: order.rating,
    review: order.review,
    receipt_event_id: order.receipt_event_id,
    events: events?.map((e) => ({ type: e.type, actor: e.actor, data: e.data, at: e.created_at.toISOString() })),
  };
}
