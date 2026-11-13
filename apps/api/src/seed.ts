// Seed data for a local or demo environment: one shop with a connected regtest wallet and a few
// open orders. Idempotent: running it twice changes nothing.
import { pino } from "pino";
import { loadConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { signup } from "./domain/auth.js";
import { createOrder } from "./domain/orders.js";
import { RateService } from "./domain/rates.js";
import { WalletRegistry } from "./domain/wallets.js";

export const DEMO = { phone: "+221770000001", pin: "482915", shop_name: "Atelier Ndeye", city: "Dakar" };

const config = loadConfig();
const log = pino({ level: "warn" });
const sql = createDb(config.DATABASE_URL);
await migrate(sql);
const ctx: AppContext = { config, sql, log, wallets: new WalletRegistry(sql, config), rates: new RateService(log) };

let [seller] = await sql<{ id: string }[]>`select id from sellers where phone = ${DEMO.phone}`;
if (!seller) {
  seller = await signup(ctx, DEMO);
  console.log(`Created demo shop "${DEMO.shop_name}"`);
}

const [wallet] = await sql`select 1 from wallets where seller_id = ${seller.id}`;
const lndUrl = process.env.SEED_SELLER_LND_URL;
const lndMacaroon = process.env.SEED_SELLER_LND_MACAROON;
if (!wallet && lndUrl && lndMacaroon) {
  await ctx.wallets.connect(seller.id, { kind: "lnd", rest_url: lndUrl, macaroon_hex: lndMacaroon });
  console.log("Connected the regtest wallet (invoice-only macaroon)");
}

const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`select count(*)::int as n from orders where seller_id = ${seller.id}`;
if (n === 0 && (wallet || lndUrl)) {
  const samples = [
    { title: "Boubou bazin brodé, bleu indigo", description: "Taille L, broderie main. Retouche offerte.", amount_xof: 35000, delivery_fee_xof: 2000, customer_label: "Awa — Sacré-Cœur" },
    { title: "Sandales cuir tressé, pointure 41", description: "Cuir de Ngaye Mékhé, semelle cousue.", amount_xof: 12000, delivery_fee_xof: 1500, customer_label: "Moussa — Ouakam" },
    { title: "Panier de bissap séché, 1 kg", description: null, amount_xof: 4500, delivery_fee_xof: 1000, customer_label: "Fatou — Médina" },
  ];
  for (const s of samples) {
    const order = await createOrder(ctx, seller.id, s);
    console.log(`  ${config.WEB_ORIGIN}/o/${order.public_id}  ${s.title}`);
  }
}

console.log(`\nDemo login  phone: ${DEMO.phone}   PIN: ${DEMO.pin}`);
ctx.wallets.closeAll();
await sql.end();
