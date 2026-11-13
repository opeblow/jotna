import { describe, expect, it } from "vitest";
import { normalizePhone, slugify } from "../src/lib/phone.js";

describe("phone and shop slug normalization", () => {
  it.each([
    ["77 123 45 67", "+221771234567"],
    ["00221 77 123 45 67", "+221771234567"],
    ["+221 (77) 123-45-67", "+221771234567"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizePhone(input, "221")).toBe(expected);
  });

  it.each(["12", "abcdefgh", "+221-abc-1234"])("rejects invalid phone number %s", (input) => {
    expect(() => normalizePhone(input, "221")).toThrow("Enter a valid phone number");
  });

  it("normalizes accented shop names and provides a fallback slug", () => {
    expect(slugify("École N'Diaye")).toBe("ecole-n-diaye");
    expect(slugify("???")).toBe("boutique");
  });
});
