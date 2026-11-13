import type { AppContext } from "../context.js";
import { hashPin, randomToken, sha256Hex, verifyPin } from "../lib/crypto.js";
import { conflict, tooMany, unauthorized } from "../lib/errors.js";
import { normalizePhone, slugify } from "../lib/phone.js";

export interface SellerRow {
  id: string;
  phone: string;
  pin_hash: string;
  shop_name: string;
  shop_slug: string;
  city: string | null;
  failed_logins: number;
  locked_until: Date | null;
  created_at: Date;
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/** A real hash to compare against when the phone number is unknown, so both paths take equally long. */
let decoyHash: Promise<string> | undefined;

async function uniqueSlug(ctx: AppContext, shopName: string): Promise<string> {
  const base = slugify(shopName);
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? base : `${base}-${Math.floor(100 + Math.random() * 900)}`;
    const [taken] = await ctx.sql`select 1 from sellers where shop_slug = ${candidate}`;
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function signup(
  ctx: AppContext,
  input: { phone: string; pin: string; shop_name: string; city?: string | null },
): Promise<SellerRow> {
  const phone = normalizePhone(input.phone, ctx.config.DEFAULT_COUNTRY_CODE);
  const pinHash = await hashPin(input.pin);
  const slug = await uniqueSlug(ctx, input.shop_name);
  try {
    const [seller] = await ctx.sql<SellerRow[]>`
      insert into sellers (phone, pin_hash, shop_name, shop_slug, city)
      values (${phone}, ${pinHash}, ${input.shop_name}, ${slug}, ${input.city ?? null})
      returning *`;
    return seller!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw conflict("phone_taken", "An account already exists for this number. Sign in instead.");
    }
    throw err;
  }
}

export async function login(ctx: AppContext, input: { phone: string; pin: string }): Promise<SellerRow> {
  const phone = normalizePhone(input.phone, ctx.config.DEFAULT_COUNTRY_CODE);
  const [seller] = await ctx.sql<SellerRow[]>`select * from sellers where phone = ${phone}`;

  if (!seller) {
    decoyHash ??= hashPin("000000");
    await verifyPin(input.pin, await decoyHash);
    throw unauthorized("Wrong phone number or PIN");
  }
  if (seller.locked_until && seller.locked_until.getTime() > Date.now()) {
    throw tooMany("Too many wrong PINs. Try again later.", {
      retry_after_seconds: Math.ceil((seller.locked_until.getTime() - Date.now()) / 1000),
    });
  }
  if (!(await verifyPin(input.pin, seller.pin_hash))) {
    // Counted in the database so the limit holds across instances and restarts.
    await ctx.sql`
      update sellers set
        failed_logins = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_logins + 1 end,
        locked_until  = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS}
                             then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
      where id = ${seller.id}`;
    throw unauthorized("Wrong phone number or PIN");
  }
  if (seller.failed_logins > 0 || seller.locked_until) {
    await ctx.sql`update sellers set failed_logins = 0, locked_until = null where id = ${seller.id}`;
  }
  return seller;
}

/** Create a session. Only the SHA-256 of the token is stored, so a database leak cannot be replayed. */
export async function createSession(ctx: AppContext, sellerId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ctx.config.SESSION_TTL_DAYS * 86_400_000);
  await ctx.sql`insert into sessions (token_hash, seller_id, expires_at) values (${sha256Hex(token)}, ${sellerId}, ${expiresAt})`;
  return { token, expiresAt };
}

export async function sellerForSession(ctx: AppContext, token: string | undefined): Promise<SellerRow | null> {
  if (!token) return null;
  const [seller] = await ctx.sql<SellerRow[]>`
    select s.* from sessions x join sellers s on s.id = x.seller_id
    where x.token_hash = ${sha256Hex(token)} and x.expires_at > now()`;
  return seller ?? null;
}

export async function destroySession(ctx: AppContext, token: string | undefined): Promise<void> {
  if (token) await ctx.sql`delete from sessions where token_hash = ${sha256Hex(token)}`;
}
