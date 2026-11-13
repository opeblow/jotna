import type { Config } from "../config.js";
import type { Db, Sql } from "../db/client.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, unprocessable } from "../lib/errors.js";
import { assertSafeUrl } from "../lib/netguard.js";
import { LndProvider, type LndCredentials } from "../lightning/lnd.js";
import { NwcProvider, parseNwcUri } from "../lightning/nwc.js";
import { HOLD_METHODS, WalletError, type LightningProvider, type WalletInfo } from "../lightning/provider.js";

export type WalletInput =
  | { kind: "nwc"; connection_uri: string }
  | { kind: "lnd"; rest_url: string; macaroon_hex: string; tls_cert_pem?: string };

export interface WalletRow {
  id: string;
  seller_id: string;
  kind: "nwc" | "lnd";
  secret_enc: string;
  alias: string | null;
  node_pubkey: string | null;
  network: string | null;
  methods: string[];
  last_ok_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

type StoredSecret = { kind: "nwc"; uri: string } | ({ kind: "lnd" } & LndCredentials);

const IDLE_MS = 5 * 60_000;

/**
 * Builds and caches Lightning providers per seller. Credentials are decrypted only here, held in
 * memory for as long as the connection is in use, and never returned by any API.
 */
export class WalletRegistry {
  private readonly cache = new Map<string, { walletId: string; provider: LightningProvider; usedAt: number }>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly sql: Sql, private readonly config: Config) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  private sweep() {
    for (const [sellerId, entry] of this.cache) {
      if (Date.now() - entry.usedAt > IDLE_MS) {
        entry.provider.close();
        this.cache.delete(sellerId);
      }
    }
  }

  private build(secret: StoredSecret): LightningProvider {
    return secret.kind === "nwc"
      ? new NwcProvider(secret.uri)
      : new LndProvider({ ...secret, allowPrivateHosts: this.config.ALLOW_PRIVATE_WALLET_HOSTS });
  }

  /** Provider for a seller's connected wallet. Throws if none is connected. */
  async forSeller(sellerId: string, db: Db = this.sql): Promise<LightningProvider> {
    const [row] = await db<Pick<WalletRow, "id" | "secret_enc">[]>`
      select id, secret_enc from wallets where seller_id = ${sellerId}`;
    if (!row) throw conflict("wallet_not_connected", "Connect a Lightning wallet before taking orders");
    const cached = this.cache.get(sellerId);
    if (cached && cached.walletId === row.id) {
      cached.usedAt = Date.now();
      return cached.provider;
    }
    cached?.provider.close();
    const secret = JSON.parse(decryptSecret(row.secret_enc, this.config.SECRETS_KEY)) as StoredSecret;
    const provider = this.build(secret);
    this.cache.set(sellerId, { walletId: row.id, provider, usedAt: Date.now() });
    return provider;
  }

  private async validate(input: WalletInput): Promise<StoredSecret> {
    const allowPrivate = this.config.ALLOW_PRIVATE_WALLET_HOSTS;
    if (input.kind === "nwc") {
      let parsed;
      try {
        parsed = parseNwcUri(input.connection_uri);
      } catch {
        throw badRequest("invalid_connection", "That does not look like a wallet connection string");
      }
      if (parsed.relayUrls.length === 0) throw badRequest("invalid_connection", "The connection string has no relay");
      for (const relay of parsed.relayUrls) {
        await assertSafeUrl(relay, { protocols: allowPrivate ? ["wss:", "ws:"] : ["wss:"], allowPrivate });
      }
      return { kind: "nwc", uri: input.connection_uri.trim() };
    }
    if (!this.config.ENABLE_LND_CONNECT) throw forbidden("lnd_disabled", "Direct node connections are not enabled");
    if (!/^[0-9a-fA-F]{20,4000}$/.test(input.macaroon_hex)) throw badRequest("invalid_macaroon", "Macaroon must be hex");
    const url = await assertSafeUrl(input.rest_url, { protocols: allowPrivate ? ["https:", "http:"] : ["https:"], allowPrivate });
    return { kind: "lnd", restUrl: url.toString(), macaroonHex: input.macaroon_hex, tlsCertPem: input.tls_cert_pem };
  }

  /** Check a credential against the live wallet, then store it encrypted. Replaces any previous wallet. */
  async connect(sellerId: string, input: WalletInput): Promise<WalletRow> {
    const secret = await this.validate(input);
    const provider = this.build(secret);
    let info: WalletInfo;
    try {
      info = await provider.getInfo();
    } catch (err) {
      provider.close();
      if (err instanceof WalletError) {
        throw unprocessable("wallet_unreachable", "We could not reach that wallet. Check the connection and try again.");
      }
      throw err;
    }
    provider.close();

    const missing = HOLD_METHODS.filter((m) => !info.methods.includes(m));
    if (missing.length > 0) {
      throw unprocessable(
        "wallet_missing_hold_invoices",
        "This wallet cannot lock payments (hold invoices). Use a wallet such as Alby Hub.",
        { missing },
      );
    }
    if (info.canSpend && !this.config.ALLOW_SPEND_CAPABLE_WALLETS) {
      throw unprocessable(
        "wallet_can_spend",
        "This connection is allowed to send money. Create a receive-only connection and paste that instead.",
      );
    }
    const expected = this.config.NETWORK === "mainnet" ? ["mainnet", "bitcoin"] : [this.config.NETWORK];
    if (info.network && !expected.includes(info.network)) {
      throw unprocessable("wallet_wrong_network", `This wallet is on ${info.network}; Jotna is running on ${this.config.NETWORK}.`);
    }

    const [{ live } = { live: 0 }] = await this.sql<{ live: number }[]>`
      select count(*)::int as live from orders
      where seller_id = ${sellerId} and status in ('awaiting_payment','funded','settling','refunding')`;
    if (live > 0) throw conflict("wallet_in_use", "Finish or cancel your active orders before changing wallet");

    const secretEnc = encryptSecret(JSON.stringify(secret), this.config.SECRETS_KEY);
    const [row] = await this.sql<WalletRow[]>`
      insert into wallets (seller_id, kind, secret_enc, alias, node_pubkey, network, methods, last_ok_at)
      values (${sellerId}, ${secret.kind}, ${secretEnc}, ${info.alias}, ${info.pubkey}, ${info.network},
              ${this.sql.json(info.methods)}, now())
      on conflict (seller_id) do update set
        id = gen_random_uuid(), kind = excluded.kind, secret_enc = excluded.secret_enc, alias = excluded.alias,
        node_pubkey = excluded.node_pubkey, network = excluded.network, methods = excluded.methods,
        last_ok_at = now(), last_error = null, updated_at = now()
      returning *`;
    this.evict(sellerId);
    return row!;
  }

  async disconnect(sellerId: string): Promise<void> {
    const [{ live } = { live: 0 }] = await this.sql<{ live: number }[]>`
      select count(*)::int as live from orders
      where seller_id = ${sellerId} and status in ('awaiting_payment','funded','settling','refunding')`;
    if (live > 0) throw conflict("wallet_in_use", "Finish or cancel your active orders before disconnecting");
    await this.sql`delete from wallets where seller_id = ${sellerId}`;
    this.evict(sellerId);
  }

  /** Live health check, recorded so the dashboard can show a stale wallet. */
  async check(sellerId: string): Promise<{ ok: boolean; error: string | null }> {
    try {
      const provider = await this.forSeller(sellerId);
      await provider.getInfo();
      await this.sql`update wallets set last_ok_at = now(), last_error = null where seller_id = ${sellerId}`;
      return { ok: true, error: null };
    } catch (err) {
      if (!(err instanceof WalletError)) throw err;
      this.evict(sellerId);
      await this.sql`update wallets set last_error = ${err.message.slice(0, 200)} where seller_id = ${sellerId}`;
      return { ok: false, error: "unreachable" };
    }
  }

  evict(sellerId: string) {
    this.cache.get(sellerId)?.provider.close();
    this.cache.delete(sellerId);
  }

  closeAll() {
    clearInterval(this.sweeper);
    for (const entry of this.cache.values()) entry.provider.close();
    this.cache.clear();
  }
}
