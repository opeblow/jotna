export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Options = { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; raw?: Blob };

/** Same-origin JSON client. Network failures surface as ApiError("offline") so the UI can say so. */
export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.raw ? { "content-type": opts.raw.type } : {}),
        ...opts.headers,
      },
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "offline", "No connection");
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* an HTML error page from a proxy */
  }
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "internal_error", e?.message ?? "Request failed", e?.details);
  }
  return json as T;
}

/** A key that stays the same across retries of one user action, so a retry never duplicates it. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Shapes returned by the API ----------------------------------------------------------------

export type OrderStatus =
  | "open" | "awaiting_payment" | "funded" | "settling" | "completed" | "refunding" | "refunded" | "cancelled";

export interface Shop {
  name: string;
  slug: string;
  city: string | null;
  member_since: string;
  delivered_count: number;
  rating_count: number;
  rating_avg: number | null;
}

export interface Me {
  seller: { id: string; phone: string; shop_name: string; shop_slug: string; city: string | null };
  shop: Shop;
  wallet: { kind: "nwc" | "lnd"; alias: string | null; network: string | null; healthy: boolean; last_ok_at: string | null } | null;
  features: { ai: boolean; lnd_connect: boolean; network: string; nostr_npub: string | null; min_order_xof: number; max_order_xof: number };
}

export interface SellerOrder {
  id: string;
  public_id: string;
  share_url: string;
  status: OrderStatus;
  title: string;
  description: string | null;
  image_url: string | null;
  customer_label: string | null;
  amount_xof: number;
  delivery_fee_xof: number;
  total_xof: number;
  delivery_window_minutes: number;
  amount_sats: number | null;
  close_reason: string | null;
  created_at: string;
  funded_at: string | null;
  deadline_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  rating: number | null;
  review: string | null;
  receipt_event_id: string | null;
  events?: { type: string; actor: string; data: Record<string, unknown>; at: string }[];
}

export interface PublicOrder {
  public_id: string;
  status: OrderStatus;
  title: string;
  description: string | null;
  image_url: string | null;
  amount_xof: number;
  delivery_fee_xof: number;
  total_xof: number;
  delivery_window_minutes: number;
  shop: Shop;
  quote: { amount_sats: number; xof_per_btc: number; as_of: string } | null;
  amount_sats: number | null;
  payment: { bolt11: string; amount_sats: number; expires_at: string } | null;
  is_buyer: boolean;
  can_cancel: boolean;
  funded_at: string | null;
  deadline_at: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  rating: number | null;
  receipt_event_id: string | null;
  network: string;
  dev_pay_enabled: boolean;
  server_time: string;
}

export interface Stats {
  waiting: number;
  locked: number;
  locked_xof: number;
  delivered_7d: number;
  delivered_7d_xof: number;
  delivered_total: number;
}
