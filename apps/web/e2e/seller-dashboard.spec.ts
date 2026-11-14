import { expect, test, type Page, type Route } from "@playwright/test";
import type { Me, SellerOrder, Stats } from "../src/lib/api";

const wallet: NonNullable<Me["wallet"]> = { kind: "nwc", alias: "Ndeye's hub", network: "regtest", healthy: true, last_ok_at: new Date().toISOString() };

function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    seller: { id: "seller-1", phone: "+221771234567", shop_name: "Atelier Ndeye", shop_slug: "atelier-ndeye", city: "Dakar" },
    shop: { name: "Atelier Ndeye", slug: "atelier-ndeye", city: "Dakar", member_since: "2026-01-01T00:00:00.000Z", delivered_count: 12, rating_count: 4, rating_avg: 4.8 },
    wallet,
    features: { ai: false, lnd_connect: true, network: "regtest", nostr_npub: null, min_order_xof: 500, max_order_xof: 500000 },
    ...overrides,
  };
}

function makeOrder(overrides: Partial<SellerOrder> = {}): SellerOrder {
  return {
    id: "order-1",
    public_id: "k7qm2xpa234567",
    share_url: "https://jotna.test/o/k7qm2xpa234567",
    status: "open",
    title: "Blue embroidered boubou",
    description: "Hand-embroidered, size L",
    image_url: null,
    customer_label: "Awa",
    amount_xof: 35000,
    delivery_fee_xof: 2000,
    total_xof: 37000,
    delivery_window_minutes: 720,
    amount_sats: null,
    close_reason: null,
    created_at: "2026-11-10T10:00:00.000Z",
    funded_at: null,
    deadline_at: null,
    dispatched_at: null,
    completed_at: null,
    closed_at: null,
    rating: null,
    review: null,
    receipt_event_id: null,
    events: [],
    ...overrides,
  };
}

const stats: Stats = { waiting: 1, locked: 1, locked_xof: 37000, delivered_7d: 3, delivered_7d_xof: 90000, delivered_total: 12 };

type Handler = (route: Route) => Promise<void> | void;

/** Answer one seller API call. Matched on method and exact path so the query string never matters. */
async function mock(page: Page, method: string, path: string, handler: Handler) {
  await page.route(
    (url) => url.pathname === `/api/v1${path}`,
    (route) => (route.request().method() === method ? handler(route) : route.fallback()),
  );
}

async function signedIn(page: Page, me: Me = makeMe()) {
  await mock(page, "GET", "/me", (route) => route.fulfill({ json: me }));
}

async function dashboardData(page: Page, orders: SellerOrder[]) {
  await mock(page, "GET", "/orders", (route) => route.fulfill({ json: { orders, next_before: null } }));
  await mock(page, "GET", "/stats", (route) => route.fulfill({ json: stats }));
}

test("a visitor without a session is sent to sign in", async ({ page }) => {
  await mock(page, "GET", "/me", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "Sign in" } } }),
  );

  await page.goto("/app");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the dashboard lists orders with their status and the locked total", async ({ page }) => {
  await signedIn(page);
  await dashboardData(page, [
    makeOrder(),
    makeOrder({ id: "order-2", title: "Wax tote bag", customer_label: null, status: "funded", total_xof: 12000 }),
  ]);

  await page.goto("/app");

  await expect(page.getByText("Hello, Atelier Ndeye")).toBeVisible();
  const first = page.getByRole("link", { name: /Blue embroidered boubou/ });
  await expect(first).toHaveAttribute("href", "/app/orders/order-1");
  await expect(first).toContainText("For Awa");
  await expect(first).toContainText("37 000 F");
  await expect(page.getByRole("link", { name: /Wax tote bag/ })).toContainText("Funds locked");
  await expect(page.getByText("Delivered this week")).toBeVisible();
  await expect(page.getByText("90 000 F")).toBeVisible();
});

test("the order filter asks the server for that slice", async ({ page }) => {
  const asked: (string | null)[] = [];
  await signedIn(page);
  await mock(page, "GET", "/stats", (route) => route.fulfill({ json: stats }));
  await mock(page, "GET", "/orders", (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    asked.push(status);
    return route.fulfill({ json: { orders: status === "done" ? [] : [makeOrder()], next_before: null } });
  });

  await page.goto("/app");
  await expect(page.getByRole("link", { name: /Blue embroidered boubou/ })).toBeVisible();
  await page.getByRole("tab", { name: "Finished" }).click();

  await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();
  expect(asked).toContain("all");
  expect(asked).toContain("done");
});

test("a shop without a wallet is told to connect one before anything else", async ({ page }) => {
  // Two cold page compiles on the dev server.
  test.slow();
  await signedIn(page, makeMe({ wallet: null }));
  await dashboardData(page, []);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Connect your wallet to get started" })).toBeVisible();
  // No "create an order" shortcut in the empty list while orders cannot be created.
  await expect(page.getByRole("link", { name: "Create an order" })).toHaveCount(0);

  await page.goto("/app/new");
  await expect(page.getByRole("heading", { name: "Connect your wallet to get started" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create the order link" })).toHaveCount(0);
});

test("an unreachable wallet is flagged on the dashboard", async ({ page }) => {
  await signedIn(page, makeMe({ wallet: { ...wallet, healthy: false } }));
  await dashboardData(page, []);

  await page.goto("/app");

  await expect(page.getByText("Your wallet is not answering. Customers cannot pay while it is offline.")).toBeVisible();
});

test("creating an order sends the form once and lands on its share link", async ({ page }) => {
  test.slow();
  let submitted: Record<string, unknown> | undefined;
  let idempotencyKey: string | undefined;
  const created = makeOrder({ id: "order-9", title: "Wax tote bag", amount_xof: 12000, delivery_fee_xof: 1500, total_xof: 13500 });

  await signedIn(page);
  await mock(page, "POST", "/orders", async (route) => {
    submitted = route.request().postDataJSON();
    idempotencyKey = route.request().headers()["idempotency-key"];
    await route.fulfill({ json: created });
  });
  await mock(page, "GET", "/orders/order-9", (route) => route.fulfill({ json: created }));

  await page.goto("/app/new");
  const create = page.getByRole("button", { name: "Create the order link" });
  await expect(create).toBeDisabled();

  await page.getByLabel("Item", { exact: true }).fill("  Wax tote bag ");
  await page.getByLabel("Item price").fill("12000");
  await page.getByLabel("Delivery fee").fill("1500");
  await page.getByLabel("Who is it for?").fill("Awa");
  await page.getByText("6 hours").click();
  await create.click();

  // The dev server compiles the order page on first visit, which can take a while on a cold run.
  await expect(page).toHaveURL(/\/app\/orders\/order-9\?new=1$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Send this link to your customer" })).toBeVisible();
  await expect(page.getByText("jotna.test/o/k7qm2xpa234567")).toBeVisible();
  await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  expect(submitted).toEqual({
    title: "Wax tote bag",
    description: null,
    amount_xof: 12000,
    delivery_fee_xof: 1500,
    customer_label: "Awa",
    delivery_window_minutes: 360,
    image_id: null,
  });
  expect(idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
});

test("an order outside the allowed amounts cannot be created", async ({ page }) => {
  await signedIn(page);

  await page.goto("/app/new");
  await page.getByLabel("Item", { exact: true }).fill("Wax tote bag");
  await page.getByLabel("Item price").fill("900000");

  await expect(page.getByText(/That amount is outside the allowed limits./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create the order link" })).toBeDisabled();
});

test("a failed order creation keeps the form and retries with the same key", async ({ page }) => {
  const keys: string[] = [];
  await signedIn(page);
  await mock(page, "POST", "/orders", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    await route.fulfill({ status: 503, json: { error: { code: "wallet_unavailable", message: "Wallet offline" } } });
  });

  await page.goto("/app/new");
  await page.getByLabel("Item", { exact: true }).fill("Wax tote bag");
  await page.getByLabel("Item price").fill("12000");
  const create = page.getByRole("button", { name: "Create the order link" });
  await create.click();
  await expect(page.getByText(/The seller's wallet is not answering./)).toBeVisible();
  await create.click();

  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByLabel("Item", { exact: true })).toHaveValue("Wax tote bag");
});

test("the seller marks a funded order as dispatched", async ({ page }) => {
  const funded = makeOrder({
    status: "funded",
    amount_sats: 10000,
    funded_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  });
  let dispatched = false;

  await signedIn(page);
  await mock(page, "GET", "/orders/order-1", (route) =>
    route.fulfill({ json: dispatched ? { ...funded, dispatched_at: new Date().toISOString() } : funded }),
  );
  await mock(page, "POST", "/orders/order-1/dispatch", async (route) => {
    dispatched = true;
    await route.fulfill({ json: { ...funded, dispatched_at: new Date().toISOString() } });
  });

  await page.goto("/app/orders/order-1");
  await expect(page.getByRole("heading", { name: "The funds are locked" })).toBeVisible();
  // The reference the rider compares at the door.
  await expect(page.getByText("K7QM2")).toBeVisible();
  await expect(page.getByText(/Automatic refund in/)).toBeVisible();
  await page.getByRole("button", { name: "I have sent the rider" }).click();

  await expect(page.getByText(/Rider on the way/)).toBeVisible();
  await expect(page.getByRole("button", { name: "I have sent the rider" })).toHaveCount(0);
  expect(dispatched).toBe(true);
});

test("refunding a funded order asks first and does nothing when declined", async ({ page }) => {
  const funded = makeOrder({ status: "funded", amount_sats: 10000, funded_at: new Date().toISOString() });
  let state: SellerOrder = funded;
  let cancelCalls = 0;
  const prompts: string[] = [];
  let accept = false;

  await signedIn(page);
  await mock(page, "GET", "/orders/order-1", (route) => route.fulfill({ json: state }));
  await mock(page, "POST", "/orders/order-1/cancel", async (route) => {
    cancelCalls += 1;
    state = { ...funded, status: "refunded", close_reason: "seller_cancelled", closed_at: new Date().toISOString() };
    await route.fulfill({ json: state });
  });
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    return accept ? dialog.accept() : dialog.dismiss();
  });

  await page.goto("/app/orders/order-1");
  const refund = page.getByRole("button", { name: "Cancel and refund the customer" });
  await refund.click();
  await expect(page.getByRole("heading", { name: "The funds are locked" })).toBeVisible();
  expect(cancelCalls).toBe(0);

  accept = true;
  await refund.click();

  await expect(page.getByRole("heading", { name: "Order refunded" })).toBeVisible();
  await expect(page.getByText("You cancelled the order. The money went back to the customer.")).toBeVisible();
  await expect(refund).toHaveCount(0);
  expect(cancelCalls).toBe(1);
  expect(prompts[0]).toBe("Refund the customer? The locked money is returned to them right away.");
});

test("a completed order shows the payout and the customer's rating", async ({ page }) => {
  await signedIn(page);
  await mock(page, "GET", "/orders/order-1", (route) =>
    route.fulfill({
      json: makeOrder({ status: "completed", amount_sats: 10000, completed_at: new Date().toISOString(), rating: 5, review: "Fast and careful" }),
    }),
  );

  await page.goto("/app/orders/order-1");

  await expect(page.getByText("37 000 F is in your wallet.")).toBeVisible();
  await expect(page.getByText("Fast and careful")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancel/ })).toHaveCount(0);
});

test("an order that does not belong to the seller reads as not found", async ({ page }) => {
  await signedIn(page);
  await mock(page, "GET", "/orders/nope", (route) =>
    route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found" } } }),
  );

  await page.goto("/app/orders/nope");

  await expect(page.getByText("Not found.")).toBeVisible();
});

test("connecting a wallet sends the pasted link and shows it connected", async ({ page }) => {
  const uri = "nostr+walletconnect://abc123?relay=wss://relay.example&secret=def456";
  let me = makeMe({ wallet: null });
  let submitted: Record<string, unknown> | undefined;

  await mock(page, "GET", "/me", (route) => route.fulfill({ json: me }));
  await mock(page, "PUT", "/wallet", async (route) => {
    submitted = route.request().postDataJSON();
    me = makeMe();
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/app/wallet");
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  await expect(connect).toBeDisabled();
  await page.getByLabel("Connection link").fill(`  ${uri} `);
  await connect.click();

  await expect(page.getByText("Ndeye's hub")).toBeVisible();
  await expect(page.getByText(/^Connected/)).toBeVisible();
  // The secret must not linger in the form once it has been sent.
  await expect(page.getByLabel("Connection link")).toHaveCount(0);
  expect(submitted).toEqual({ kind: "nwc", connection_uri: uri });
});

test("a wallet connection that could spend is refused with a clear reason", async ({ page }) => {
  await signedIn(page, makeMe({ wallet: null }));
  await mock(page, "PUT", "/wallet", (route) =>
    route.fulfill({ status: 422, json: { error: { code: "wallet_can_spend", message: "Connection can spend" } } }),
  );

  await page.goto("/app/wallet");
  await page.getByLabel("Connection link").fill("nostr+walletconnect://abc123?relay=wss://relay.example&secret=def456");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByText(/This connection can send money./)).toBeVisible();
  await expect(page.getByLabel("Connection link")).toBeVisible();
});

test("the LND tab is hidden unless the server allows it, and sends node details when used", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  const macaroon = "0201036c6e6402f801030a10";

  await signedIn(page, makeMe({ wallet: null }));
  await mock(page, "PUT", "/wallet", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/app/wallet");
  await page.getByRole("tab", { name: "LND node" }).click();
  await page.getByLabel("REST address").fill("https://my-node:8080");
  await page.getByLabel("Macaroon (hex)").fill(macaroon);
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect.poll(() => submitted).toEqual({ kind: "lnd", rest_url: "https://my-node:8080", macaroon_hex: macaroon });

  const hidden = await page.context().newPage();
  await signedIn(hidden, makeMe({ wallet: null, features: { ...makeMe().features, lnd_connect: false } }));
  await hidden.goto("/app/wallet");
  await expect(hidden.getByLabel("Connection link")).toBeVisible();
  await expect(hidden.getByRole("tab")).toHaveCount(0);
});

test("disconnecting a wallet asks first", async ({ page }) => {
  let me = makeMe();
  let deleted = 0;
  let accept = false;

  await mock(page, "GET", "/me", (route) => route.fulfill({ json: me }));
  await mock(page, "DELETE", "/wallet", async (route) => {
    deleted += 1;
    me = makeMe({ wallet: null });
    await route.fulfill({ json: { ok: true } });
  });
  page.on("dialog", (dialog) => (accept ? dialog.accept() : dialog.dismiss()));

  await page.goto("/app/wallet");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Ndeye's hub")).toBeVisible();
  expect(deleted).toBe(0);

  accept = true;
  await page.getByRole("button", { name: "Disconnect" }).click();

  await expect(page.getByLabel("Connection link")).toBeVisible();
  expect(deleted).toBe(1);
});

test("signing out ends the session and returns to the home page", async ({ page }) => {
  let loggedOut = false;
  await signedIn(page);
  await dashboardData(page, []);
  await mock(page, "POST", "/auth/logout", async (route) => {
    loggedOut = true;
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/app");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paid at the door");
  expect(loggedOut).toBe(true);
});
