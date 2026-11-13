// End-to-end check against a running API and the regtest stack. Real Lightning payments, no mocks.
//
//   node scripts/e2e.mjs            (API on http://127.0.0.1:4000, stack from scripts/dev-stack.mjs)
//
// Covers: signup, wallet connect, idempotent order creation, checkout, lock detection, wrong code,
// release (and replay), buyer cancel → refund, cancel-after-dispatch refusal, seller refund, rating.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const sha = (buf) => createHash("sha256").update(buf).digest();
let cookie = "";
let passed = 0;

async function api(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json, headers: res.headers };
}

function check(name, condition, detail) {
  if (!condition) {
    console.error(`✗ ${name}`, detail ?? "");
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitStatus(publicId, wanted, buyerKey) {
  for (let i = 0; i < 40; i++) {
    const r = await api("GET", `/v1/public/orders/${publicId}`, null, buyerKey ? { "x-jotna-buyer": buyerKey } : {});
    if (r.body.status === wanted) return r.body;
    await sleep(500);
  }
  throw new Error(`order ${publicId} never reached ${wanted}`);
}

/** What the buyer's browser does: derive the release secret and the buyer key from a random code. */
function buyerSecrets(publicId) {
  const code = randomBytes(10).toString("hex");
  const preimage = sha(`jotna/v1/preimage|${publicId}|${code}`);
  const buyerKey = sha(`jotna/v1/buyer|${publicId}|${code}`);
  return {
    preimage: preimage.toString("hex"),
    paymentHash: sha(preimage).toString("hex"),
    buyerKey: buyerKey.toString("hex"),
    buyerKeyHash: sha(buyerKey).toString("hex"),
  };
}

async function newOrder(title) {
  const r = await api("POST", "/v1/orders", { title, amount_xof: 15000, delivery_fee_xof: 1500 }, { "idempotency-key": `e2e-${randomBytes(8).toString("hex")}` });
  if (r.status !== 201) throw new Error(`create order failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function payAndLock(order) {
  const s = buyerSecrets(order.public_id);
  const co = await api("POST", `/v1/public/orders/${order.public_id}/checkout`, { payment_hash: s.paymentHash, buyer_key_hash: s.buyerKeyHash });
  if (co.status !== 200) throw new Error(`checkout failed: ${JSON.stringify(co.body)}`);
  const pay = await api("POST", "/v1/dev/pay", { bolt11: co.body.payment.bolt11 });
  if (pay.status !== 200) throw new Error(`pay failed: ${JSON.stringify(pay.body)}`);
  await waitStatus(order.public_id, "funded");
  return { s, checkout: co.body };
}

// ---- Account and wallet ------------------------------------------------------------------------
const phone = "+22177" + String(Math.floor(1000000 + Math.random() * 8999999));
let r = await api("POST", "/v1/auth/signup", { phone, pin: "739104", shop_name: "E2E Boutique" });
check("signup creates a session", r.status === 201 && cookie.startsWith("jotna_sid="), r.body);

r = await api("POST", "/v1/orders", { title: "No wallet yet", amount_xof: 5000 }, { "idempotency-key": "e2e-nowallet-" + randomBytes(6).toString("hex") });
check("orders are refused until a wallet is connected", r.status === 409 && r.body.error.code === "wallet_not_connected", r.body);

r = await api("PUT", "/v1/wallet", { kind: "lnd", rest_url: env.DEV_BUYER_LND_URL, macaroon_hex: env.DEV_BUYER_LND_MACAROON });
check("a wallet credential that can spend is refused", r.status === 422 && r.body.error.code === "wallet_can_spend", r.body);

r = await api("PUT", "/v1/wallet", { kind: "lnd", rest_url: env.SEED_SELLER_LND_URL, macaroon_hex: env.SEED_SELLER_LND_MACAROON });
check("an invoice-only wallet credential is accepted", r.status === 200 && r.body.network === "regtest", r.body);

// ---- Idempotent creation -----------------------------------------------------------------------
const key = "e2e-" + randomBytes(8).toString("hex");
const body = { title: "Boubou bazin", amount_xof: 15000, delivery_fee_xof: 1500 };
const [a, b] = await Promise.all([api("POST", "/v1/orders", body, { "idempotency-key": key }), api("POST", "/v1/orders", body, { "idempotency-key": key })]);
const firstOk = [a, b].find((x) => x.status === 201);
check("concurrent duplicates create one order", firstOk && [a, b].every((x) => x.status === 201 || x.status === 409), [a.status, b.status]);
const replay = await api("POST", "/v1/orders", body, { "idempotency-key": key });
check("a retry replays the stored response", replay.status === 201 && replay.body.id === firstOk.body.id && replay.headers.get("idempotent-replayed") === "true");
r = await api("POST", "/v1/orders", { ...body, amount_xof: 99999 }, { "idempotency-key": key });
check("reusing a key with a different body is rejected", r.status === 422 && r.body.error.code === "idempotency_key_reused", r.body);
r = await api("POST", "/v1/orders", body);
check("a missing Idempotency-Key is rejected", r.status === 400, r.body);

// ---- Happy path: lock, wrong code, release -----------------------------------------------------
const order1 = firstOk.body;
r = await api("GET", `/v1/public/orders/${order1.public_id}`);
check("the public order shows a live quote and no private fields", r.body.quote?.amount_sats > 0 && !("customer_label" in r.body), r.body);

const s1 = buyerSecrets(order1.public_id);
const co1 = await api("POST", `/v1/public/orders/${order1.public_id}/checkout`, { payment_hash: s1.paymentHash, buyer_key_hash: s1.buyerKeyHash });
check("checkout returns a regtest hold invoice", co1.status === 200 && co1.body.payment.bolt11.startsWith("lnbcrt"), co1.body);
const again = await api("POST", `/v1/public/orders/${order1.public_id}/checkout`, { payment_hash: s1.paymentHash, buyer_key_hash: s1.buyerKeyHash });
check("repeating checkout returns the same invoice", again.body.payment?.bolt11 === co1.body.payment.bolt11);
const other = buyerSecrets(order1.public_id);
r = await api("POST", `/v1/public/orders/${order1.public_id}/checkout`, { payment_hash: other.paymentHash, buyer_key_hash: other.buyerKeyHash });
check("a second device cannot start a competing checkout", r.status === 409 && r.body.error.code === "checkout_in_progress", r.body);
r = await api("GET", `/v1/public/orders/${order1.public_id}`);
check("the invoice is hidden from other viewers of the link", r.body.payment === null);

r = await api("POST", `/v1/public/orders/${order1.public_id}/release`, { preimage: s1.preimage });
check("release before payment is refused", r.status === 409, r.body);

r = await api("POST", "/v1/dev/pay", { bolt11: co1.body.payment.bolt11 });
check("the buyer node pays the invoice", r.status === 200, r.body);
const funded = await waitStatus(order1.public_id, "funded", s1.buyerKey);
check("the worker detects the locked payment", funded.status === "funded" && funded.deadline_at && funded.can_cancel === true);

r = await api("POST", `/v1/public/orders/${order1.public_id}/release`, { preimage: randomBytes(32).toString("hex") });
check("a wrong release code is rejected", r.status === 422 && r.body.error.code === "wrong_code", r.body);
r = await api("POST", `/v1/orders/${order1.id}/dispatch`);
check("the seller marks the order dispatched", r.status === 200 && r.body.dispatched_at, r.body);
r = await api("POST", `/v1/public/orders/${order1.public_id}/cancel`, { buyer_key: s1.buyerKey });
check("the buyer cannot cancel once the rider has left", r.status === 409 && r.body.error.code === "already_dispatched", r.body);

r = await api("POST", `/v1/public/orders/${order1.public_id}/release`, { preimage: s1.preimage });
check("the correct code releases the payment", r.status === 200 && r.body.status === "completed", r.body);
r = await api("POST", `/v1/public/orders/${order1.public_id}/release`, { preimage: s1.preimage });
check("releasing twice is harmless", r.status === 200 && r.body.status === "completed", r.body);

r = await api("POST", `/v1/public/orders/${order1.public_id}/rating`, { buyer_key: other.buyerKey, stars: 5 });
check("only the paying device can rate", r.status === 403, r.body);
r = await api("POST", `/v1/public/orders/${order1.public_id}/rating`, { buyer_key: s1.buyerKey, stars: 5, review: "Livré en une heure." });
check("the buyer rates the delivery", r.status === 200 && r.body.rating === 5, r.body);

// ---- Buyer cancels before dispatch → refund ----------------------------------------------------
const order2 = await newOrder("Sandales cuir");
const p2 = await payAndLock(order2);
r = await api("POST", `/v1/public/orders/${order2.public_id}/cancel`, { buyer_key: p2.s.buyerKey });
check("the buyer cancels before dispatch and is refunded", r.status === 200 && r.body.status === "refunded", r.body);
r = await api("POST", `/v1/public/orders/${order2.public_id}/release`, { preimage: p2.s.preimage });
check("a refunded order cannot be released", r.status === 409, r.body);

// ---- Seller refunds a locked order -------------------------------------------------------------
const order3 = await newOrder("Bissap 1 kg");
await payAndLock(order3);
r = await api("POST", `/v1/orders/${order3.id}/cancel`);
check("the seller refunds a locked order", r.status === 200 && r.body.status === "refunded", r.body);

// ---- Seller cancels an unpaid link -------------------------------------------------------------
const order4 = await newOrder("Lien annulé");
r = await api("POST", `/v1/orders/${order4.id}/cancel`);
check("the seller cancels an unpaid order", r.status === 200 && r.body.status === "cancelled", r.body);
const s4 = buyerSecrets(order4.public_id);
r = await api("POST", `/v1/public/orders/${order4.public_id}/checkout`, { payment_hash: s4.paymentHash, buyer_key_hash: s4.buyerKeyHash });
check("a cancelled order cannot be paid", r.status === 409 && r.body.error.code === "order_not_payable", r.body);

// ---- Access control and CSRF -------------------------------------------------------------------
const saved = cookie;
cookie = "";
r = await api("GET", `/v1/orders/${order1.id}`);
check("seller endpoints require a session", r.status === 401);
cookie = saved;
r = await api("POST", `/v1/orders/${order1.id}/cancel`, null, { origin: "https://evil.example" });
check("cross-site requests are refused", r.status === 403 && r.body.error.code === "bad_origin", r.body);

r = await api("GET", "/v1/stats");
check("stats reflect the delivered order", r.body.delivered_total === 1 && r.body.delivered_7d_xof === 16500, r.body);
r = await api("GET", `/v1/public/shops/e2e-boutique`);
console.log(`\n${passed} checks passed.`);
