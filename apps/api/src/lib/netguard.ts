import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { badRequest } from "./errors.js";

/**
 * Wallet connections make the server open sockets to hosts chosen by users. Without a guard that is
 * a server-side request forgery primitive (cloud metadata, internal admin ports, the database).
 * We resolve the host and refuse anything that is not a public unicast address.
 */
function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number) as [number, number, number, number];
  return (
    p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 192 && p[1] === 0) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
    p[0] >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) {
    const tail = v.slice(7);
    return isIP(tail) === 4 ? isPrivateV4(tail) : true;
  }
  return /^(fc|fd|fe[89ab]|ff)/.test(v);
}

export const isPrivateAddress = (ip: string) => (isIP(ip) === 4 ? isPrivateV4(ip) : isPrivateV6(ip));

async function addressesForHost(host: string) {
  const family = isIP(host);
  return family ? [{ address: host, family }] : lookup(host, { all: true });
}

/** Re-resolve and validate a host at connection time to prevent DNS rebinding. */
export async function resolvePublicAddress(host: string, allowPrivate = false) {
  const addresses = await addressesForHost(host);
  if (addresses.length === 0 || (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address)))) {
    throw new Error("Wallet host must resolve only to public addresses");
  }
  return addresses[0]!;
}

export async function assertSafeUrl(
  rawUrl: string,
  opts: { protocols: string[]; allowPrivate: boolean },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw badRequest("invalid_url", "That address is not a valid URL");
  }
  if (!opts.protocols.includes(url.protocol)) {
    throw badRequest("invalid_url", `Address must use ${opts.protocols.join(" or ")}`);
  }
  if (url.username || url.password) throw badRequest("invalid_url", "Address must not contain credentials");
  if (opts.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = (await addressesForHost(host).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw badRequest("invalid_url", "That host could not be resolved");
  if (addresses.some(isPrivateAddress)) {
    throw badRequest("private_host", "Wallet endpoints on private networks are not allowed");
  }
  return url;
}
