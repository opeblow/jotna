import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashPin,
  randomPublicId,
  randomToken,
  safeEqualHex,
  sha256Hex,
  verifyPin,
} from "../src/lib/crypto.js";

describe("cryptographic helpers", () => {
  it("uses salted scrypt PIN hashes and verifies them", async () => {
    const first = await hashPin("739104");
    const second = await hashPin("739104");

    expect(first).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(first).not.toBe(second);
    await expect(verifyPin("739104", first)).resolves.toBe(true);
    await expect(verifyPin("000000", first)).resolves.toBe(false);
    await expect(verifyPin("739104", "invalid")).resolves.toBe(false);
  });

  it("authenticates encrypted secrets and rejects tampering", () => {
    const key = "a".repeat(64);
    const envelope = encryptSecret("wallet credential", key);

    expect(envelope).not.toBe(encryptSecret("wallet credential", key));
    expect(decryptSecret(envelope, key)).toBe("wallet credential");
    expect(() => decryptSecret(envelope, "b".repeat(64))).toThrow();

    const parts = envelope.split(".");
    const ciphertext = parts[3]!;
    parts[3] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("generates unguessable session tokens and constrained public IDs", () => {
    const token = randomToken();
    const publicId = randomPublicId();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(publicId).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{14}$/);
    expect(randomToken()).not.toBe(token);
  });

  it("compares hex values safely and hashes deterministically", () => {
    expect(safeEqualHex("aabb", "aabb")).toBe(true);
    expect(safeEqualHex("aabb", "aa")).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
    expect(sha256Hex("jotna")).toBe("0ec178b5675e3d8ac8a5998bfdb29caba6dc9a60379c878d253be494e59be86b");
  });
});
