import { describe, expect, it } from "vitest";
import { msatToSats, xofToMsat } from "../src/lib/money.js";

describe("integer money conversions", () => {
  it("converts XOF to millisatoshis without losing seller value", () => {
    expect(xofToMsat(100_000, 10_000_000_000)).toBe(1_000_000n);
    expect(xofToMsat(1, 100_000_000_000)).toBe(1_000n);
  });

  it.each([0, -1, 1.5])("rejects invalid XOF amounts: %s", (amount) => {
    expect(() => xofToMsat(amount, 10_000_000_000)).toThrow("totalXof must be a positive integer");
  });

  it("rejects non-positive BTC/XOF rates and converts millisatoshis to whole sats", () => {
    expect(() => xofToMsat(1000, 0)).toThrow("xofPerBtc must be positive");
    expect(msatToSats(1999)).toBe(1);
    expect(msatToSats("2000")).toBe(2);
  });
});
