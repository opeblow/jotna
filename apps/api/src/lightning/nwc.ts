import { NWCClient, Nip47WalletError } from "@getalby/sdk";
import {
  WalletError,
  type HoldInvoiceRequest,
  type InvoiceLookup,
  type LightningProvider,
  type WalletInfo,
} from "./provider.js";

const SPEND_METHODS = ["pay_invoice", "pay_keysend", "multi_pay_invoice", "multi_pay_keysend"];

/** Relay URLs and wallet pubkey from a connection string, without touching the network. */
export function parseNwcUri(uri: string): { relayUrls: string[]; walletPubkey: string } {
  const opts = NWCClient.parseWalletConnectUrl(uri.trim());
  const relayUrls = (opts as { relayUrls?: string[]; relayUrl?: string }).relayUrls ??
    [(opts as { relayUrl?: string }).relayUrl].filter((r): r is string => Boolean(r));
  return { relayUrls, walletPubkey: opts.walletPubkey };
}

/**
 * Talks to any wallet that speaks Nostr Wallet Connect (NIP-47) with hold-invoice support,
 * for example Alby Hub. The connection secret is scoped by the wallet to the methods it grants.
 */
export class NwcProvider implements LightningProvider {
  private readonly client: NWCClient;

  constructor(connectionUri: string) {
    this.client = new NWCClient({ nostrWalletConnectUrl: connectionUri.trim() });
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Nip47WalletError) {
        // The wallet answered and said no: not a transport problem, do not hammer it.
        throw new WalletError(`Wallet refused: ${err.message}`, false);
      }
      throw new WalletError(`Wallet unreachable: ${(err as Error).message}`);
    }
  }

  async getInfo(): Promise<WalletInfo> {
    const info = await this.run(() => this.client.getInfo());
    const methods = info.methods as string[];
    return {
      alias: info.alias || null,
      pubkey: info.pubkey || null,
      network: info.network || null,
      methods,
      canSpend: methods.some((m) => SPEND_METHODS.includes(m)),
    };
  }

  async createHoldInvoice(req: HoldInvoiceRequest): Promise<{ bolt11: string }> {
    const tx = await this.run(() =>
      this.client.makeHoldInvoice({
        amount: Number(req.amountMsat),
        description: req.description,
        expiry: req.expirySeconds,
        payment_hash: req.paymentHash,
      }),
    );
    if (!tx.invoice) throw new WalletError("Wallet returned no invoice", false);
    return { bolt11: tx.invoice };
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceLookup> {
    const tx = await this.run(() => this.client.lookupInvoice({ payment_hash: paymentHash }));
    const settleDeadline = tx.settle_deadline ? new Date(tx.settle_deadline * 1000) : null;
    switch (tx.state) {
      case "settled":
        return { state: "settled", settleDeadline: null };
      case "accepted":
        return { state: "held", settleDeadline };
      case "failed":
        return { state: "cancelled", settleDeadline: null };
      default:
        return { state: "open", settleDeadline: null };
    }
  }

  async settle(preimage: string): Promise<void> {
    await this.run(() => this.client.settleHoldInvoice({ preimage }));
  }

  async cancel(paymentHash: string): Promise<void> {
    await this.run(() => this.client.cancelHoldInvoice({ payment_hash: paymentHash }));
  }

  close(): void {
    try {
      this.client.close();
    } catch {
      /* already closed */
    }
  }
}
