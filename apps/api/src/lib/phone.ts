import { badRequest } from "./errors.js";

/** Normalise a phone number to E.164. Local numbers get the configured country code. */
export function normalizePhone(input: string, defaultCountryCode: string): string {
  const raw = input.replace(/[\s().-]/g, "");
  let digits: string;
  if (raw.startsWith("+")) digits = raw.slice(1);
  else if (raw.startsWith("00")) digits = raw.slice(2);
  else digits = defaultCountryCode + raw.replace(/^0+/, "");
  if (!/^\d{8,15}$/.test(digits)) throw badRequest("invalid_phone", "Enter a valid phone number");
  return `+${digits}`;
}

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s.length >= 2 ? s : "boutique";
}
