/** The CFA franc (XOF) is pegged to the euro at a fixed rate, so BTC/XOF is derived from BTC/EUR. */
export const XOF_PER_EUR = 655.957;

const MSAT_PER_BTC = 100_000_000_000n;

/**
 * Convert a CFA amount to millisatoshi at the given rate, rounded up to a whole satoshi so the
 * seller is never short by a rounding error. Integer math only.
 */
export function xofToMsat(totalXof: number, xofPerBtc: number): bigint {
  if (!Number.isInteger(totalXof) || totalXof <= 0) throw new Error("totalXof must be a positive integer");
  if (!(xofPerBtc > 0)) throw new Error("xofPerBtc must be positive");
  const rateCenti = BigInt(Math.round(xofPerBtc * 100)); // XOF per BTC, two decimals
  const msat = (BigInt(totalXof) * 100n * MSAT_PER_BTC) / rateCenti;
  const sats = (msat + 999n) / 1000n;
  return sats * 1000n;
}

export const msatToSats = (msat: bigint | number | string): number => Number(BigInt(msat) / 1000n);
