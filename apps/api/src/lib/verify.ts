import type { Config } from "../config.js";
import { badRequest, tooMany, unavailable } from "./errors.js";

export type VerifyChannel = "sms" | "whatsapp";

/** Proves that whoever is signing up can read messages sent to a phone number. */
export interface PhoneVerifier {
  /** Send a one-time code to the number. */
  send(phone: string, locale: "fr" | "en"): Promise<void>;
  /** Throws unless the code is the one that was sent. A code can be used once. */
  check(phone: string, code: string): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

interface TwilioOptions {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  channel: VerifyChannel;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

// Twilio error codes: https://www.twilio.com/docs/api/errors
const INVALID_NUMBER = new Set([60200, 60205, 21211, 21614]);
const TOO_MANY = new Set([60202, 60203, 60212, 20429]);
/** The destination is blocked, unsupported, or (on a trial account) not a verified caller ID. */
const UNDELIVERABLE = new Set([60410, 60605, 60220, 21408, 21608]);

/**
 * Twilio Verify. Twilio generates, delivers and checks the code, so no code is ever stored here.
 * It also enforces its own limits per number: five sends and five wrong guesses per code.
 */
export class TwilioVerifier implements PhoneVerifier {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: TwilioOptions) {
    this.base = `${opts.baseUrl ?? "https://verify.twilio.com"}/v2/Services/${opts.serviceSid}`;
    this.auth = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64")}`;
    this.fetch = opts.fetch ?? (fetch as unknown as FetchLike);
  }

  private async post(path: string, form: Record<string, string>): Promise<{ status: number; body: { status?: string; code?: number } }> {
    try {
      const res = await this.fetch(`${this.base}${path}`, {
        method: "POST",
        headers: { authorization: this.auth, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; code?: number };
      return { status: res.status, body: body ?? {} };
    } catch {
      throw unavailable("verification_unavailable", "We could not send a code right now. Try again in a moment.");
    }
  }

  private fail(status: number, code: number | undefined): never {
    if (code !== undefined && INVALID_NUMBER.has(code)) throw badRequest("invalid_phone", "Enter a valid phone number");
    if (status === 429 || (code !== undefined && TOO_MANY.has(code))) {
      throw tooMany("Too many codes requested for this number. Try again later.");
    }
    if (code !== undefined && UNDELIVERABLE.has(code)) {
      throw badRequest("phone_unreachable", "We cannot send a code to this number");
    }
    // Wrong credentials, a suspended account, an outage: nothing the visitor can fix.
    throw unavailable("verification_unavailable", "We could not send a code right now. Try again in a moment.");
  }

  async send(phone: string, locale: "fr" | "en"): Promise<void> {
    const { status, body } = await this.post("/Verifications", { To: phone, Channel: this.opts.channel, Locale: locale });
    if (status < 200 || status >= 300) this.fail(status, body.code);
  }

  async check(phone: string, code: string): Promise<void> {
    const { status, body } = await this.post("/VerificationCheck", { To: phone, Code: code });
    // 404: no pending code for this number. It expired, was already used, or was never requested.
    if (status === 404) throw badRequest("code_expired", "This code has expired. Ask for a new one.");
    if (status < 200 || status >= 300) this.fail(status, body.code);
    if (body.status !== "approved") throw badRequest("wrong_sms_code", "That code is not right");
  }
}

/** The verifier for this deployment, or null when sign-up does not verify phone numbers. */
export function createPhoneVerifier(config: Config): PhoneVerifier | null {
  if (!config.phoneVerification) return null;
  return new TwilioVerifier({
    accountSid: config.TWILIO_ACCOUNT_SID!,
    authToken: config.TWILIO_AUTH_TOKEN!,
    serviceSid: config.TWILIO_VERIFY_SERVICE_SID!,
    channel: config.PHONE_VERIFICATION_CHANNEL,
  });
}
