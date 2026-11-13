/**
 * The only Lightning capabilities Jotna needs from a seller's wallet. Every method is receive-side:
 * there is deliberately no way to send a payment through this interface.
 */
export type InvoiceState = "open" | "held" | "settled" | "cancelled";

export interface WalletInfo {
  alias: string | null;
  pubkey: string | null;
  network: string | null;
  methods: string[];
  /** True when the credential could also spend the seller's funds. */
  canSpend: boolean;
}

export interface HoldInvoiceRequest {
  paymentHash: string; // hex
  amountMsat: bigint;
  description: string;
  expirySeconds: number;
  cltvDelta: number;
}

export interface InvoiceLookup {
  state: InvoiceState;
  /** Latest moment the invoice can still be settled before the node gives the money back. */
  settleDeadline: Date | null;
}

export interface LightningProvider {
  getInfo(): Promise<WalletInfo>;
  createHoldInvoice(req: HoldInvoiceRequest): Promise<{ bolt11: string }>;
  lookupInvoice(paymentHash: string): Promise<InvoiceLookup>;
  /** Claim held funds. Must be safe to call again with the same preimage. */
  settle(preimage: string): Promise<void>;
  /** Release held funds back to the payer, or void an unpaid invoice. Safe to repeat. */
  cancel(paymentHash: string): Promise<void>;
  close(): void;
}

/** The wallet could not be reached or answered with an error. Callers may retry. */
export class WalletError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}

export const HOLD_METHODS = ["make_hold_invoice", "settle_hold_invoice", "cancel_hold_invoice", "lookup_invoice"];
