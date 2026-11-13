import type { Logger } from "pino";
import { unavailable } from "../lib/errors.js";
import { XOF_PER_EUR } from "../lib/money.js";

export interface Rate {
  xofPerBtc: number;
  asOf: Date;
  sources: string[];
}

type Source = { name: string; fetch: () => Promise<number> };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const SOURCES: Source[] = [
  { name: "coinbase", fetch: async () => Number((await getJson("https://api.coinbase.com/v2/prices/BTC-EUR/spot")).data.amount) },
  { name: "kraken", fetch: async () => Number((await getJson("https://api.kraken.com/0/public/Ticker?pair=XBTEUR")).result.XXBTZEUR.c[0]) },
  { name: "bitstamp", fetch: async () => Number((await getJson("https://www.bitstamp.net/api/v2/ticker/btceur/")).last) },
];

const FRESH_MS = 60_000;
/** Beyond this age we refuse to quote rather than price an order on a stale number. */
const MAX_STALE_MS = 10 * 60_000;
/** Sources that disagree with the median by more than this are ignored. */
const MAX_DEVIATION = 0.03;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** BTC price in CFA francs: median of several public EUR tickers times the fixed XOF/EUR peg. */
export class RateService {
  private current: Rate | null = null;
  private inflight: Promise<Rate> | null = null;

  constructor(private readonly log: Logger, private readonly sources: Source[] = SOURCES) {}

  async get(): Promise<Rate> {
    const age = this.current ? Date.now() - this.current.asOf.getTime() : Infinity;
    if (this.current && age < FRESH_MS) return this.current;
    try {
      this.inflight ??= this.refresh().finally(() => (this.inflight = null));
      return await this.inflight;
    } catch (err) {
      if (this.current && age < MAX_STALE_MS) {
        this.log.warn({ err: (err as Error).message }, "rate refresh failed, serving cached rate");
        return this.current;
      }
      throw unavailable("rate_unavailable", "The exchange rate is temporarily unavailable. Try again in a moment.");
    }
  }

  private async refresh(): Promise<Rate> {
    const results = await Promise.allSettled(this.sources.map((s) => s.fetch()));
    const quotes = results
      .map((r, i) => ({ name: this.sources[i]!.name, value: r.status === "fulfilled" ? r.value : NaN }))
      .filter((q) => Number.isFinite(q.value) && q.value > 0);
    if (quotes.length === 0) throw new Error("no price source answered");
    const mid = median(quotes.map((q) => q.value));
    const agreed = quotes.filter((q) => Math.abs(q.value - mid) / mid <= MAX_DEVIATION);
    const eur = median(agreed.map((q) => q.value));
    this.current = {
      xofPerBtc: Math.round(eur * XOF_PER_EUR * 100) / 100,
      asOf: new Date(),
      sources: agreed.map((q) => q.name),
    };
    return this.current;
  }
}
