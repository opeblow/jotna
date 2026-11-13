import { finalizeEvent, getPublicKey, type EventTemplate, type VerifiedEvent } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import { npubEncode } from "nostr-tools/nip19";
import type { AppContext } from "../context.js";

/** Addressable application data (NIP-78). One replaceable record per order, keyed by its `d` tag. */
const KIND_APP_DATA = 30078;

const secretKey = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

export function platformNpub(ctx: AppContext): string | null {
  return ctx.config.NOSTR_SECRET_KEY ? npubEncode(getPublicKey(secretKey(ctx.config.NOSTR_SECRET_KEY))) : null;
}

/**
 * A delivery receipt anyone can verify without trusting Jotna's database: it carries the payment
 * hash and the preimage that settled it (sha256(preimage) = hash). It contains no names, phone
 * numbers, addresses or item descriptions.
 */
export function buildReceipt(input: {
  publicId: string;
  shopSlug: string;
  totalXof: number;
  amountSats: number;
  paymentHash: string;
  preimage: string;
  completedAt: Date;
}): EventTemplate {
  return {
    kind: KIND_APP_DATA,
    created_at: Math.floor(input.completedAt.getTime() / 1000),
    tags: [
      ["d", `jotna:receipt:${input.publicId}`],
      ["t", "jotna-receipt"],
      ["shop", input.shopSlug],
      ["amount", String(input.totalXof), "XOF"],
      ["amount", String(input.amountSats), "SAT"],
      ["x", input.paymentHash],
      ["preimage", input.preimage],
    ],
    content: `Delivered and paid: order ${input.publicId} from ${input.shopSlug}.`,
  };
}

export function buildRating(input: { publicId: string; shopSlug: string; stars: number; review: string | null; ratedAt: Date }): EventTemplate {
  return {
    kind: KIND_APP_DATA,
    created_at: Math.floor(input.ratedAt.getTime() / 1000),
    tags: [
      ["d", `jotna:rating:${input.publicId}`],
      ["t", "jotna-rating"],
      ["shop", input.shopSlug],
      ["rating", String(input.stars), "5"],
    ],
    content: input.review ?? "",
  };
}

export function sign(ctx: AppContext, template: EventTemplate): VerifiedEvent {
  if (!ctx.config.NOSTR_SECRET_KEY) throw new Error("NOSTR_SECRET_KEY is not configured");
  return finalizeEvent(template, secretKey(ctx.config.NOSTR_SECRET_KEY));
}

/** Publish to every configured relay. Succeeds if at least one relay accepts the event. */
export async function publish(ctx: AppContext, event: VerifiedEvent): Promise<number> {
  const results = await Promise.allSettled(
    ctx.config.nostrRelays.map(async (url) => {
      const relay = await Relay.connect(url);
      try {
        await Promise.race([
          relay.publish(event),
          new Promise((_, reject) => setTimeout(() => reject(new Error("publish timeout")), 8000)),
        ]);
      } finally {
        relay.close();
      }
    }),
  );
  const accepted = results.filter((r) => r.status === "fulfilled").length;
  if (accepted === 0) {
    const reason = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    throw new Error(`no relay accepted the event: ${reason instanceof Error ? reason.message : String(reason)}`);
  }
  return accepted;
}
