/**
 * A 6-digit PIN has only a million values, and people do not pick them uniformly. With the account
 * lockout an attacker gets a handful of guesses per account, so they try the same few popular PINs
 * against many accounts. Refusing the predictable shapes takes those guesses away.
 */
export function isWeakPin(pin: string, phone = ""): boolean {
  if (!/^\d{6}$/.test(pin)) return true;
  const d = [...pin].map(Number);

  // 000000, 777777
  if (new Set(d).size === 1) return true;
  // 123456, 987654, 890123 (straight runs up or down, wrapping at 9/0)
  const steps = d.slice(1).map((n, i) => (n - d[i]! + 10) % 10);
  if (steps.every((s) => s === 1) || steps.every((s) => s === 9)) return true;
  // 121212, 123123, 112233
  if (pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin) return true;
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5]) return true;
  // 123321
  if (pin === [...pin].reverse().join("")) return true;
  // The seller's own number is the first thing someone who knows them would try.
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 6 && (digits.endsWith(pin) || digits.includes(pin))) return true;
  // Dates of birth: DDMMYY and 19xx / 20xx years followed or preceded by two digits.
  if (/^(19|20)\d{4}$/.test(pin) || /^\d{2}(19|20)\d{2}$/.test(pin)) return true;

  return false;
}
