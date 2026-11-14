import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPhoneVerifier, TwilioVerifier } from "../src/lib/verify.js";

const required = { DATABASE_URL: "postgres://jotna:test@localhost:5432/jotna", SECRETS_KEY: "ab".repeat(32), NODE_ENV: "test" };
const twilio = {
  TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_VERIFY_SERVICE_SID: `VA${"1".repeat(32)}`,
};

interface Call {
  url: string;
  headers: Record<string, string>;
  form: Record<string, string>;
}

function verifier(reply: { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const v = new TwilioVerifier({
    accountSid: twilio.TWILIO_ACCOUNT_SID,
    authToken: "token",
    serviceSid: twilio.TWILIO_VERIFY_SERVICE_SID,
    channel: "sms",
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, form: Object.fromEntries(new URLSearchParams(init.body)) });
      if (reply instanceof Error) throw reply;
      return { status: reply.status, json: async () => reply.body ?? {} };
    },
  });
  return { v, calls };
}

describe("phone verification", () => {
  it("asks Twilio to send a code to the number, in the visitor's language", async () => {
    const { v, calls } = verifier({ status: 201, body: { status: "pending" } });
    await v.send("+221771234567", "fr");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://verify.twilio.com/v2/Services/${twilio.TWILIO_VERIFY_SERVICE_SID}/Verifications`);
    expect(calls[0]!.form).toEqual({ To: "+221771234567", Channel: "sms", Locale: "fr" });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`${twilio.TWILIO_ACCOUNT_SID}:token`).toString("base64")}`);
  });

  it("accepts only an approved check", async () => {
    const ok = verifier({ status: 200, body: { status: "approved" } });
    await expect(ok.v.check("+221771234567", "123456")).resolves.toBeUndefined();
    expect(ok.calls[0]!.form).toEqual({ To: "+221771234567", Code: "123456" });

    const wrong = verifier({ status: 200, body: { status: "pending" } });
    await expect(wrong.v.check("+221771234567", "000000")).rejects.toMatchObject({ status: 400, code: "wrong_sms_code" });
  });

  it("reports a code that expired, was already used or was never requested", async () => {
    const { v } = verifier({ status: 404, body: { code: 20404 } });
    await expect(v.check("+221771234567", "123456")).rejects.toMatchObject({ status: 400, code: "code_expired" });
  });

  it("tells apart a bad number, a rate limit, an unreachable number and an outage", async () => {
    const send = (reply: Parameters<typeof verifier>[0]) => verifier(reply).v.send("+221771234567", "en");

    await expect(send({ status: 400, body: { code: 60200 } })).rejects.toMatchObject({ status: 400, code: "invalid_phone" });
    await expect(send({ status: 429, body: { code: 60203 } })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    await expect(send({ status: 403, body: { code: 60410 } })).rejects.toMatchObject({ status: 400, code: "phone_unreachable" });
    await expect(send({ status: 401, body: { code: 20003 } })).rejects.toMatchObject({ status: 503, code: "verification_unavailable" });
    await expect(send(new Error("socket hang up"))).rejects.toMatchObject({ status: 503, code: "verification_unavailable" });
  });

  it("never lets a wrong-credentials reply pass as a verified number", async () => {
    const { v } = verifier({ status: 401, body: { code: 20003 } });
    await expect(v.check("+221771234567", "123456")).rejects.toMatchObject({ code: "verification_unavailable" });
  });

  it("is on only when Twilio is fully configured", () => {
    expect(createPhoneVerifier(loadConfig(required))).toBeNull();
    expect(createPhoneVerifier(loadConfig({ ...required, ...twilio }))).toBeInstanceOf(TwilioVerifier);
    expect(createPhoneVerifier(loadConfig({ ...required, ...twilio, PHONE_VERIFICATION: "off" }))).toBeNull();
    expect(() => loadConfig({ ...required, TWILIO_ACCOUNT_SID: twilio.TWILIO_ACCOUNT_SID })).toThrow("together");
  });

  it("cannot be switched off in production once configured", () => {
    const production = { ...required, ...twilio, NODE_ENV: "production", NETWORK: "mainnet", WEB_ORIGIN: "https://jotna.example" };
    expect(loadConfig(production).phoneVerification).toBe(true);
    expect(() => loadConfig({ ...production, PHONE_VERIFICATION: "off" })).toThrow("phone verification");
  });
});
