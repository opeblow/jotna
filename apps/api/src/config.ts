import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

/**
 * How many reverse proxies sit in front of the API.
 *   false        – none: the socket address is the client (API exposed directly).
 *   1, 2, …      – that many trusted hops; the client address is read from X-Forwarded-For
 *                  counting from the right, so a client cannot spoof it by sending its own header.
 *   a.b.c.d/nn,… – trust exactly these proxy addresses.
 * Getting this wrong in either direction breaks IP rate limiting: too low and every user shares
 * the proxy's bucket (one abuser locks everyone out), too high and clients can forge their address.
 */
const trustProxy = z
  .string()
  .optional()
  .transform((v, ctx): boolean | number | string => {
    const raw = (v ?? "").trim().toLowerCase();
    if (raw === "" || ["false", "no", "off", "0"].includes(raw)) return false;
    if (["true", "yes", "on"].includes(raw)) return true;
    if (/^\d{1,2}$/.test(raw)) return Number(raw);
    if (/^[0-9a-f.:/,\s]+$/.test(raw)) return raw;
    ctx.addIssue({ code: "custom", message: "TRUST_PROXY must be false, a hop count, or a list of proxy addresses" });
    return false;
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.string().default("info"),

  DATABASE_URL: z.string().min(1),
  /** Public origin of the web app. Used for the CSRF origin check and for building share links. */
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** 32-byte key (64 hex chars) that encrypts wallet credentials at rest. */
  SECRETS_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "SECRETS_KEY must be 64 hex characters (32 bytes)"),

  NETWORK: z.enum(["regtest", "signet", "testnet", "mainnet"]).default("regtest"),
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default("221"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  INVOICE_EXPIRY_SECONDS: z.coerce.number().int().min(120).default(900),
  DEFAULT_DELIVERY_WINDOW_MINUTES: z.coerce.number().int().default(720),
  /** Final CLTV delta requested for hold invoices (blocks). Bounds how long funds can stay locked. */
  HOLD_CLTV_DELTA: z.coerce.number().int().min(40).max(1000).default(200),
  /** After the seller marks an order dispatched, the buyer cannot cancel for this long. */
  DISPATCH_GRACE_MINUTES: z.coerce.number().int().min(0).max(1080).default(120),
  MIN_ORDER_XOF: z.coerce.number().int().default(200),
  MAX_ORDER_XOF: z.coerce.number().int().default(1_000_000),

  /** Direct LND connections accept a URL from the user, so they are opt-in (SSRF surface). */
  ENABLE_LND_CONNECT: bool(false),
  /** Allow wallet endpoints on private/loopback addresses. Only for local development. */
  ALLOW_PRIVATE_WALLET_HOSTS: bool(false),
  /** Jotna only needs to receive. Connections that can also spend are refused unless this is set. */
  ALLOW_SPEND_CAPABLE_WALLETS: bool(false),

  NOSTR_SECRET_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().or(z.literal("")),
  NOSTR_RELAYS: z.string().default(""),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),

  /** Regtest only: a second LND node that plays the buyer so the full flow can be exercised locally. */
  DEV_BUYER_LND_URL: z.string().optional(),
  DEV_BUYER_LND_MACAROON: z.string().optional(),

  WORKER_INLINE: bool(true),
  TRUST_PROXY: trustProxy,
});

export type Config = z.infer<typeof schema> & { nostrRelays: string[]; isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    const origin = new URL(c.WEB_ORIGIN);
    if (origin.protocol !== "https:" || origin.origin !== c.WEB_ORIGIN) {
      throw new Error("Production requires WEB_ORIGIN to be an HTTPS origin without a path");
    }
    if (c.NETWORK === "regtest") {
      throw new Error("Production cannot use the regtest network");
    }
    if (c.ALLOW_PRIVATE_WALLET_HOSTS) {
      throw new Error("Production cannot allow private wallet hosts");
    }
    if (c.ALLOW_SPEND_CAPABLE_WALLETS) {
      throw new Error("Production cannot allow spend-capable wallets");
    }
    if (c.DEV_BUYER_LND_URL || c.DEV_BUYER_LND_MACAROON) {
      throw new Error("Production cannot enable the development buyer wallet");
    }
  }
  if (c.NETWORK === "mainnet" && c.ALLOW_PRIVATE_WALLET_HOSTS) {
    throw new Error("ALLOW_PRIVATE_WALLET_HOSTS must be off on mainnet");
  }
  if (c.DEV_BUYER_LND_URL && c.NETWORK !== "regtest") {
    throw new Error("DEV_BUYER_LND_URL is only allowed on regtest");
  }
  return {
    ...c,
    nostrRelays: c.NOSTR_RELAYS.split(",").map((s) => s.trim()).filter(Boolean),
    isProd: c.NODE_ENV === "production",
  };
}
