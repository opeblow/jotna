import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { AppError, unavailable, unprocessable } from "../lib/errors.js";

const ListingDraft = z.object({
  title: z.string().describe("Short product title, at most 60 characters, in the seller's language"),
  description: z.string().describe("One or two plain sentences a buyer would find useful. Empty string if nothing to add."),
  amount_xof: z.number().int().nullable().describe("Price of the goods in CFA francs if the seller stated one, otherwise null"),
  delivery_fee_xof: z.number().int().nullable().describe("Delivery fee in CFA francs if stated, otherwise null"),
});
export type ListingDraft = z.infer<typeof ListingDraft>;

const SYSTEM = `You help small sellers in Senegal who sell through WhatsApp and Instagram turn a rough note, and sometimes a photo, into a clean order for their customer.

The seller writes quickly, often mixing French, Wolof and English, with shorthand prices ("15k", "15 000f", "15mille" all mean 15000 CFA francs; "liv 1500" or "livraison 1500" is a delivery fee).

Write the title and description in the language the seller mostly used (French if unclear). Describe only what the note or photo actually shows: the buyer will hold the seller to it, so never invent materials, sizes, brands or condition. Keep it plain and specific, with no sales language and no emoji.

Only fill a price when the seller stated it. Prices are whole CFA francs.`;

let client: Anthropic | undefined;

export const aiEnabled = (ctx: AppContext) => Boolean(ctx.config.ANTHROPIC_API_KEY);

export async function draftListing(
  ctx: AppContext,
  input: { text: string; image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } },
): Promise<ListingDraft> {
  if (!ctx.config.ANTHROPIC_API_KEY) throw unavailable("ai_disabled", "The writing assistant is not configured");
  client ??= new Anthropic({ apiKey: ctx.config.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) content.push({ type: "image", source: { type: "base64", media_type: input.image.media_type, data: input.image.data } });
  content.push({ type: "text", text: input.text.trim() || "(no note, see the photo)" });

  try {
    const response = await client.messages.parse({
      model: ctx.config.AI_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(ListingDraft) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw unprocessable("ai_no_draft", "The assistant could not write this one. Fill in the order by hand.");
    }
    const draft = response.parsed_output;
    return {
      title: draft.title.slice(0, 80),
      description: draft.description.slice(0, 500),
      amount_xof: draft.amount_xof && draft.amount_xof > 0 ? draft.amount_xof : null,
      delivery_fee_xof: draft.delivery_fee_xof !== null && draft.delivery_fee_xof >= 0 ? draft.delivery_fee_xof : null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof Anthropic.RateLimitError) throw new AppError(429, "ai_busy", "The assistant is busy. Try again in a minute.");
    if (err instanceof Anthropic.APIError) {
      ctx.log.warn({ status: err.status, type: err.name }, "listing assistant request failed");
      throw new AppError(502, "ai_unavailable", "The assistant is unavailable right now. Fill in the order by hand.");
    }
    throw err;
  }
}
