import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { PublicOrder } from "../src/lib/api";
import { deriveSecrets } from "../src/lib/secrets";

const publicId = "k7qm2xpa234567";
const recoveryCode = "23456789ABCDEFGH";

function makeOrder(overrides: Partial<PublicOrder> = {}): PublicOrder {
  return {
    public_id: publicId,
    status: "open",
    title: "Blue embroidered boubou",
    description: "Hand-embroidered, size L",
    image_url: null,
    amount_xof: 35000,
    delivery_fee_xof: 2000,
    total_xof: 37000,
    delivery_window_minutes: 60,
    shop: {
      name: "Atelier Ndeye",
      slug: "atelier-ndeye",
      city: "Dakar",
      member_since: "2026-01-01T00:00:00.000Z",
      delivered_count: 12,
      rating_count: 4,
      rating_avg: 4.8,
    },
    quote: { amount_sats: 10000, xof_per_btc: 37000000, as_of: new Date().toISOString() },
    amount_sats: null,
    payment: null,
    is_buyer: false,
    can_cancel: false,
    cancel_available_at: null,
    funded_at: null,
    deadline_at: null,
    dispatched_at: null,
    completed_at: null,
    closed_at: null,
    close_reason: null,
    rating: null,
    receipt_event_id: null,
    network: "regtest",
    dev_pay_enabled: false,
    server_time: new Date().toISOString(),
    ...overrides,
  };
}

function invoiceOrder(expiresAt: string): PublicOrder {
  return makeOrder({
    status: "awaiting_payment",
    is_buyer: true,
    amount_sats: 10000,
    payment: { bolt11: "lnbc100n1testinvoice", amount_sats: 10000, expires_at: expiresAt },
  });
}

test("home page presents the escrow flow and a shop CTA", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paid at the door");
  await expect(page.getByRole("link", { name: "Open my shop" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how");
});

test("shop signup explains the self-created PIN and validates required fields", async ({ page }) => {
  await page.goto("/start");

  const createShop = page.getByRole("button", { name: "Open my shop" });
  await expect(createShop).toBeDisabled();
  await expect(page.getByText("Create this code yourself; it will not be sent by SMS. Avoid 123456.")).toBeVisible();

  await page.getByLabel("Shop name").fill("Atelier Ndeye");
  await page.getByLabel("Phone number").fill("771234567");
  await page.getByLabel("6-digit secret code").fill("739104");
  await expect(page.getByLabel("Shop name")).toHaveValue("Atelier Ndeye");
  await expect(page.getByLabel("Phone number")).toHaveValue("771234567");
  await expect(page.getByLabel("6-digit secret code")).toHaveValue("739104");
  await expect(createShop).toBeEnabled();
});

test("login requires a phone number and six-digit PIN", async ({ page }) => {
  await page.goto("/login");

  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeDisabled();
  await page.getByLabel("Phone number").fill("771234567");
  await page.getByLabel("6-digit secret code").fill("739104");
  await expect(page.getByLabel("Phone number")).toHaveValue("771234567");
  await expect(page.getByLabel("6-digit secret code")).toHaveValue("739104");
  await expect(signIn).toBeEnabled();
});

test("buyer can create a checkout and receives a recoverable code", async ({ page }) => {
  const checkout = makeOrder();
  let submitted: { payment_hash: string; buyer_key_hash: string } | undefined;

  await page.route(`**/api/v1/public/orders/${publicId}`, (route) => route.fulfill({ json: checkout }));
  await page.route(`**/api/v1/public/orders/${publicId}/checkout`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: invoiceOrder(new Date(Date.now() + 5 * 60_000).toISOString()) });
  });

  await page.goto(`/o/${publicId}`);
  await page.getByRole("button", { name: "Pay and lock" }).click();

  await expect(page.getByRole("heading", { name: "Scan to lock the payment" })).toBeVisible();
  await expect(page.getByText("Backup code")).toBeVisible();
  expect(submitted?.payment_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(submitted?.buyer_key_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(submitted?.payment_hash).not.toBe(submitted?.buyer_key_hash);
});

test("buyer retry after an expired invoice gets a new secret code", async ({ page }) => {
  const hashes: string[] = [];
  let checkoutCount = 0;

  await page.route(`**/api/v1/public/orders/${publicId}`, (route) => route.fulfill({ json: makeOrder() }));
  await page.route(`**/api/v1/public/orders/${publicId}/checkout`, async (route) => {
    hashes.push(route.request().postDataJSON().payment_hash);
    checkoutCount += 1;
    const expiresAt = checkoutCount === 1
      ? new Date(Date.now() - 1000).toISOString()
      : new Date(Date.now() + 5 * 60_000).toISOString();
    await route.fulfill({ json: invoiceOrder(expiresAt) });
  });

  await page.goto(`/o/${publicId}`);
  await page.getByRole("button", { name: "Pay and lock" }).click();
  await page.getByRole("button", { name: "Get a new code" }).click();

  await expect(page.getByRole("heading", { name: "Scan to lock the payment" })).toBeVisible();
  expect(hashes).toHaveLength(2);
  expect(hashes[1]).not.toBe(hashes[0]);
});

test("buyer can recover a funded order with the backup code", async ({ page }) => {
  const funded = makeOrder({ status: "funded", amount_sats: 10000 });
  const buyerKey = deriveSecrets(publicId, recoveryCode).buyerKey;

  await page.route(`**/api/v1/public/orders/${publicId}`, async (route) => {
    const isBuyer = route.request().headers()["x-jotna-buyer"] === buyerKey;
    await route.fulfill({ json: isBuyer ? { ...funded, is_buyer: true } : funded });
  });

  await page.goto(`/o/${publicId}`);
  await page.getByLabel("Backup code").fill(recoveryCode);
  await page.getByRole("button", { name: "Find my order" }).click();

  await expect(page.getByRole("heading", { name: "Payment locked" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Show this to the rider" })).toBeVisible();
});

test("rider must confirm before releasing a funded order", async ({ page }) => {
  const funded = makeOrder({ status: "funded", amount_sats: 10000 });
  const completed = makeOrder({ status: "completed", amount_sats: 10000, completed_at: new Date().toISOString() });
  let submitted: { preimage: string } | undefined;

  await page.route(`**/api/v1/public/orders/${publicId}`, (route) => route.fulfill({ json: funded }));
  await page.route(`**/api/v1/public/orders/${publicId}/release`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: completed });
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(`/r/${publicId}#${recoveryCode}`);
  await expect(page.getByText("K7QM2")).toBeVisible();
  await page.getByRole("button", { name: "Yes, release the payment" }).click();

  await expect(page.getByText("You can hand over the parcel.")).toBeVisible();
  expect(submitted?.preimage).toMatch(/^[a-f0-9]{64}$/);
});

test("a payment that lands at the last second keeps the buyer's original code", async ({ page }) => {
  // The invoice looks expired, the buyer asks for a new one, but the first payment had just locked.
  // The device must still hold the first code: it is the only thing that can release that payment.
  let firstBuyerKeyHash: string | undefined;
  let checkoutCount = 0;
  let paid = false;
  const sha256 = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");

  await page.route(`**/api/v1/public/orders/${publicId}`, async (route) => {
    if (!paid) return route.fulfill({ json: makeOrder() });
    const header = route.request().headers()["x-jotna-buyer"];
    const isBuyer = Boolean(header) && sha256(header!) === firstBuyerKeyHash;
    await route.fulfill({ json: makeOrder({ status: "funded", amount_sats: 10000, is_buyer: isBuyer }) });
  });
  await page.route(`**/api/v1/public/orders/${publicId}/checkout`, async (route) => {
    checkoutCount += 1;
    if (checkoutCount === 1) {
      firstBuyerKeyHash = route.request().postDataJSON().buyer_key_hash;
      return route.fulfill({ json: invoiceOrder(new Date(Date.now() - 1000).toISOString()) });
    }
    paid = true;
    await route.fulfill({ status: 409, json: { error: { code: "order_not_payable", message: "This order can no longer be paid" } } });
  });

  await page.goto(`/o/${publicId}`);
  await page.getByRole("button", { name: "Pay and lock" }).click();
  await page.getByRole("button", { name: "Get a new code" }).click();

  await expect(page.getByRole("heading", { name: "Payment locked" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Show this to the rider" })).toBeVisible();
  expect(checkoutCount).toBe(2);
});

test("buyer can release the payment without the rider's phone", async ({ page }) => {
  const secrets = deriveSecrets(publicId, recoveryCode);
  let submitted: { preimage: string } | undefined;

  await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [`jotna:code:${publicId}`, recoveryCode]);
  await page.route(`**/api/v1/public/orders/${publicId}`, (route) =>
    route.fulfill({ json: makeOrder({ status: "funded", amount_sats: 10000, is_buyer: true }) }),
  );
  await page.route(`**/api/v1/public/orders/${publicId}/release`, async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: makeOrder({ status: "completed", amount_sats: 10000, is_buyer: true, completed_at: new Date().toISOString() }) });
  });
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto(`/o/${publicId}`);
  await page.getByRole("button", { name: "I have my parcel" }).click();

  await expect(page.getByRole("heading", { name: "Paid. Enjoy your parcel!" })).toBeVisible();
  expect(submitted?.preimage).toBe(secrets.preimage);
});

test("a second visitor can still pay while someone else has an unpaid invoice", async ({ page }) => {
  await page.route(`**/api/v1/public/orders/${publicId}`, (route) =>
    route.fulfill({ json: makeOrder({ status: "awaiting_payment", is_buyer: false }) }),
  );
  await page.goto(`/o/${publicId}`);
  await expect(page.getByRole("button", { name: "Pay and lock" })).toBeEnabled();
  await expect(page.getByLabel("Backup code")).toHaveCount(0);
});
