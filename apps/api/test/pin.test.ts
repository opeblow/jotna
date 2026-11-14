import { describe, expect, it } from "vitest";
import { isWeakPin } from "../src/lib/pin.js";

describe("PIN strength", () => {
  it.each(["000000", "777777", "123456", "654321", "890123", "121212", "123123", "112233", "123321", "199408", "152004"])(
    "refuses the predictable PIN %s",
    (pin) => expect(isWeakPin(pin)).toBe(true),
  );

  it("refuses a PIN taken from the seller's own phone number", () => {
    expect(isWeakPin("345678", "+221 77 123 45 67")).toBe(true);
    expect(isWeakPin("234567", "771234567")).toBe(true);
    expect(isWeakPin("712345", "771234567")).toBe(true);
  });

  it.each(["482915", "739104", "905263", "316078"])("accepts the ordinary PIN %s", (pin) =>
    expect(isWeakPin(pin, "+221770000001")).toBe(false),
  );

  it("refuses anything that is not six digits", () => {
    expect(isWeakPin("12345")).toBe(true);
    expect(isWeakPin("12345a")).toBe(true);
  });
});
