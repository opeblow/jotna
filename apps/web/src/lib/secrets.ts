import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * The buyer's release code never leaves the buyer's device until delivery.
 *
 * From one random code we derive two independent secrets:
 *   preimage  – unlocks the Lightning payment. Its hash goes into the invoice. Revealed at the door.
 *   buyer key – proves "I am the device that paid" for cancelling and rating. Never unlocks money.
 *
 * The code has 80 bits of entropy, so knowing the payment hash does not help anyone guess it.
 * @noble/hashes is used instead of WebCrypto because crypto.subtle is unavailable on plain-HTTP
 * origins (for example when testing from a phone on the local network).
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 symbols, no 0/O/1/I

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}

export const normalizeCode = (input: string) => input.toUpperCase().replace(/[^0-9A-Z]/g, "");
export const isValidCode = (input: string) => /^[2-9A-HJ-NP-Z]{16}$/.test(normalizeCode(input));
export const formatCode = (code: string) => normalizeCode(code).replace(/(.{4})(?=.)/g, "$1 ");

export interface BuyerSecrets {
  code: string;
  preimage: string;
  paymentHash: string;
  buyerKey: string;
  buyerKeyHash: string;
}

export function deriveSecrets(publicId: string, rawCode: string): BuyerSecrets {
  const code = normalizeCode(rawCode);
  const preimage = sha256(utf8ToBytes(`jotna/v1/preimage|${publicId}|${code}`));
  const buyerKey = sha256(utf8ToBytes(`jotna/v1/buyer|${publicId}|${code}`));
  return {
    code,
    preimage: bytesToHex(preimage),
    paymentHash: bytesToHex(sha256(preimage)),
    buyerKey: bytesToHex(buyerKey),
    buyerKeyHash: bytesToHex(sha256(buyerKey)),
  };
}

const storageKey = (publicId: string) => `jotna:code:${publicId}`;

export function loadCode(publicId: string): string | null {
  try {
    const code = localStorage.getItem(storageKey(publicId));
    return code && isValidCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function saveCode(publicId: string, code: string): boolean {
  try {
    localStorage.setItem(storageKey(publicId), normalizeCode(code));
    return true;
  } catch {
    return false; // private browsing: the code lives only in this tab
  }
}

export function forgetCode(publicId: string) {
  try {
    localStorage.removeItem(storageKey(publicId));
  } catch {
    /* nothing stored */
  }
}
