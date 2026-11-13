import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { devPayInvoice } from "../../lightning/lnd.js";

/**
 * Regtest only. Registered solely when DEV_BUYER_LND_URL is set, which the configuration loader
 * refuses on any other network. It pays a real invoice from a second local node that plays the
 * buyer, so the whole flow can be exercised without owning a phone wallet with test coins.
 */
export async function devRoutes(app: FastifyInstance) {
  const { ctx } = app;
  app.post("/dev/pay", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { bolt11 } = z.object({ bolt11: z.string().regex(/^lnbcrt[0-9a-z]+$/, "regtest invoices only") }).parse(req.body);
    await devPayInvoice({ restUrl: ctx.config.DEV_BUYER_LND_URL!, macaroonHex: ctx.config.DEV_BUYER_LND_MACAROON ?? "" }, bolt11);
    return { ok: true };
  });
}
