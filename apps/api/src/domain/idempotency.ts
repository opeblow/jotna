import type { Sql } from "../db/client.js";
import { sha256Hex } from "../lib/crypto.js";
import { AppError, badRequest, conflict, unprocessable } from "../lib/errors.js";

export interface StoredResponse {
  status: number;
  body: unknown;
}

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
/** An in-progress marker older than this belongs to a request that died; it may be taken over. */
const STALE_LOCK_SECONDS = 60;

/**
 * Run `handler` at most once per (scope, key).
 *
 * Mobile networks drop responses: the phone retries a request the server already executed. With an
 * Idempotency-Key the retry receives the stored response instead of creating a second order.
 *
 *  - first request      → runs the handler, stores status + body
 *  - retry, same body   → replays the stored response
 *  - retry, other body  → 422 (the key is being reused for something else)
 *  - concurrent request → 409 (the first one is still running)
 *
 * Client errors (4xx) are stored too, so a retry gets the same answer. Server errors are not:
 * the marker is removed and the client may try again.
 */
export async function withIdempotency(
  sql: Sql,
  scope: string,
  key: string | undefined,
  requestBody: unknown,
  handler: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (!key) throw badRequest("idempotency_key_required", "Send an Idempotency-Key header with this request");
  if (!KEY_PATTERN.test(key)) throw badRequest("idempotency_key_invalid", "Idempotency-Key must be 8 to 128 URL-safe characters");
  const requestHash = sha256Hex(JSON.stringify(requestBody ?? null));

  const [claimed] = await sql`
    insert into idempotency_keys (scope, key, request_hash) values (${scope}, ${key}, ${requestHash})
    on conflict (scope, key) do update
      set request_hash = excluded.request_hash, created_at = now()
      where idempotency_keys.state = 'in_progress'
        and idempotency_keys.created_at < now() - make_interval(secs => ${STALE_LOCK_SECONDS})
    returning key`;

  if (!claimed) {
    const [existing] = await sql<{ request_hash: string; state: string; response_status: number | null; response_body: unknown }[]>`
      select request_hash, state, response_status, response_body from idempotency_keys where scope = ${scope} and key = ${key}`;
    if (!existing) throw conflict("idempotency_retry", "Please retry the request");
    if (existing.request_hash !== requestHash) {
      throw unprocessable("idempotency_key_reused", "This Idempotency-Key was already used with a different request");
    }
    if (existing.state !== "done") throw conflict("request_in_progress", "The original request is still being processed");
    return { status: existing.response_status!, body: existing.response_body, replayed: true };
  }

  const store = (res: StoredResponse) => sql`
    update idempotency_keys set state = 'done', response_status = ${res.status}, response_body = ${sql.json(res.body as never)}
    where scope = ${scope} and key = ${key}`;

  try {
    const result = await handler();
    await store(result);
    return { ...result, replayed: false };
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      await store({ status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } });
    } else {
      await sql`delete from idempotency_keys where scope = ${scope} and key = ${key}`;
    }
    throw err;
  }
}
