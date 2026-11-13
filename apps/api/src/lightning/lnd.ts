import { Agent, fetch as undiciFetch } from "undici";
import { resolvePublicAddress } from "../lib/netguard.js";
import {
  HOLD_METHODS,
  WalletError,
  type HoldInvoiceRequest,
  type InvoiceLookup,
  type LightningProvider,
  type WalletInfo,
} from "./provider.js";

export interface LndCredentials {
  restUrl: string;
  macaroonHex: string;
  /** PEM certificate when the node uses its self-signed TLS certificate. */
  tlsCertPem?: string;
  allowPrivateHosts?: boolean;
}

const hexToB64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
/** URL-safe base64 with padding, which is what LND's REST gateway expects for bytes in a query string. */
const hexToB64Url = (hex: string) =>
  encodeURIComponent(Buffer.from(hex, "hex").toString("base64").replace(/\+/g, "-").replace(/\//g, "_"));

/** Seconds per block used to turn an HTLC expiry height into a wall-clock deadline. */
const BLOCK_SECONDS = 600;
/** LND fails held HTLCs back a few blocks before expiry; stay clear of that margin. */
const SAFETY_BLOCKS = 12;

/** Talks to an LND node over its REST API using a macaroon scoped to invoices. */
export class LndProvider implements LightningProvider {
  private readonly base: string;
  private readonly agent: Agent;

  constructor(private readonly creds: LndCredentials) {
    this.base = creds.restUrl.replace(/\/+$/, "");
    this.agent = new Agent({
      connect: {
        ...(creds.tlsCertPem ? { ca: creds.tlsCertPem } : {}),
        lookup: (hostname, _options, callback) => {
          void resolvePublicAddress(hostname, this.creds.allowPrivateHosts).then(
            ({ address, family }) => callback(null, address, family),
            (error: Error) => callback(error, "", 0),
          );
        },
      },
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res;
    try {
      res = await undiciFetch(this.base + path, {
        method,
        dispatcher: this.agent,
        headers: {
          "Grpc-Metadata-macaroon": this.creds.macaroonHex,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch (err) {
      throw new WalletError(`LND unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        /* not JSON */
      }
      throw new WalletError(`LND ${res.status}: ${message}`, res.status >= 500);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async getInfo(): Promise<WalletInfo> {
    const info = await this.call<{ alias?: string; identity_pubkey?: string; chains?: { network?: string }[] }>(
      "GET",
      "/v1/getinfo",
    );
    return {
      alias: info.alias ?? null,
      pubkey: info.identity_pubkey ?? null,
      network: info.chains?.[0]?.network ?? null,
      methods: HOLD_METHODS,
      canSpend: await this.canSpend(),
    };
  }

  /**
   * Probe the send permission with an empty payment request. A macaroon without it is rejected with
   * "permission denied" before LND looks at the payload; one with it fails on the (invalid, harmless)
   * payload instead. Anything we cannot interpret is treated as "can spend", the safe assumption.
   */
  private async canSpend(): Promise<boolean> {
    try {
      const res = await undiciFetch(this.base + "/v2/router/send", {
        method: "POST",
        dispatcher: this.agent,
        headers: { "Grpc-Metadata-macaroon": this.creds.macaroonHex, "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      return !/permission denied/i.test(await res.text());
    } catch {
      return true;
    }
  }

  async createHoldInvoice(req: HoldInvoiceRequest): Promise<{ bolt11: string }> {
    const out = await this.call<{ payment_request: string }>("POST", "/v2/invoices/hodl", {
      hash: hexToB64(req.paymentHash),
      value_msat: req.amountMsat.toString(),
      memo: req.description,
      expiry: String(req.expirySeconds),
      cltv_expiry: String(req.cltvDelta),
    });
    return { bolt11: out.payment_request };
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceLookup> {
    const inv = await this.call<{
      state: "OPEN" | "SETTLED" | "CANCELED" | "ACCEPTED";
      htlcs?: { expiry_height?: number; state?: string }[];
    }>("GET", `/v2/invoices/lookup?payment_hash=${hexToB64Url(paymentHash)}`);

    if (inv.state === "SETTLED") return { state: "settled", settleDeadline: null };
    if (inv.state === "CANCELED") return { state: "cancelled", settleDeadline: null };
    if (inv.state === "OPEN") return { state: "open", settleDeadline: null };

    const heights = (inv.htlcs ?? []).map((h) => h.expiry_height ?? 0).filter((h) => h > 0);
    let settleDeadline: Date | null = null;
    if (heights.length > 0) {
      const info = await this.call<{ block_height: number }>("GET", "/v1/getinfo");
      const blocksLeft = Math.min(...heights) - info.block_height - SAFETY_BLOCKS;
      settleDeadline = new Date(Date.now() + Math.max(blocksLeft, 0) * BLOCK_SECONDS * 1000);
    }
    return { state: "held", settleDeadline };
  }

  async settle(preimage: string): Promise<void> {
    await this.call("POST", "/v2/invoices/settle", { preimage: hexToB64(preimage) });
  }

  async cancel(paymentHash: string): Promise<void> {
    await this.call("POST", "/v2/invoices/cancel", { payment_hash: hexToB64(paymentHash) });
  }

  close(): void {
    void this.agent.close().catch(() => {});
  }
}

/**
 * Regtest helper: pay an invoice from a second node that plays the buyer. A hold invoice does not
 * resolve until it is settled or cancelled, so we start the payment and return once it is in flight.
 */
export async function devPayInvoice(creds: LndCredentials, bolt11: string): Promise<void> {
  const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
  const res = await undiciFetch(creds.restUrl.replace(/\/+$/, "") + "/v2/router/send", {
    method: "POST",
    dispatcher: agent,
    headers: { "Grpc-Metadata-macaroon": creds.macaroonHex, "content-type": "application/json" },
    body: JSON.stringify({ payment_request: bolt11, timeout_seconds: 60, fee_limit_sat: "1000", no_inflight_updates: false }),
    redirect: "error",
  });
  if (!res.ok || !res.body) throw new WalletError(`Buyer node refused the payment (${res.status})`);
  // Read the first status update, then leave the stream open in the background.
  const reader = res.body.getReader();
  const first = await reader.read();
  const text = first.value ? Buffer.from(first.value).toString("utf8") : "";
  if (text.includes('"error"') || text.includes("FAILED")) {
    void reader.cancel().catch(() => {});
    throw new WalletError(`Buyer node could not pay: ${text.slice(0, 200)}`, false);
  }
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        /* drain until the hold invoice resolves */
      }
    } catch {
      /* connection closed */
    } finally {
      void agent.close().catch(() => {});
    }
  })();
}
