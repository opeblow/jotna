// Live check of the sign-in lockout and the trusted-device exemption, against a running API.
//
//   node scripts/e2e-auth.mjs
//
// These scenarios sign up with made-up numbers, so start the API with PHONE_VERIFICATION=off when
// Twilio is configured. Each scenario uses its own phone number: sign-in attempts are rate limited per visitor and number.

const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const PIN = "739104";
let passed = 0;

const newPhone = () => "+22175" + String(Math.floor(1000000 + Math.random() * 8999999));
const post = async (path, body, cookie) => {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, cookies: res.headers.getSetCookie() };
};
const deviceCookie = (res) => res.cookies.find((c) => c.startsWith("jotna_dev="));
const check = (name, ok, detail) => {
  if (!ok) {
    console.error(`✗ ${name}`, detail ?? "");
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${name}`);
};

// ---- A stranger tries to lock the owner out ----------------------------------------------------
{
  const phone = newPhone();
  const signup = await post("/v1/auth/signup", { phone, pin: PIN, shop_name: "Lockout Test" });
  const device = deviceCookie(signup)?.split(";")[0];
  check("sign-up registers the device", signup.status === 201 && Boolean(device), signup);
  check("the device token is httpOnly and only sent to the sign-in endpoints", /HttpOnly/i.test(deviceCookie(signup)) && /Path=\/api\/v1\/auth/i.test(deviceCookie(signup)), signup.cookies);

  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await post("/v1/auth/login", { phone, pin: "000001" })).status);
  check("wrong PINs are refused", wrong.every((s) => s === 401), wrong);

  const stranger = await post("/v1/auth/login", { phone, pin: PIN });
  check("after five wrong PINs an unknown device is locked out, even with the right PIN", stranger.status === 429, stranger.status);

  const owner = await post("/v1/auth/login", { phone, pin: PIN }, device);
  check("the owner's own device still signs in during the lockout", owner.status === 200, owner.status);
}

// ---- A trusted device is not a way to guess the PIN --------------------------------------------
{
  const phone = newPhone();
  const signup = await post("/v1/auth/signup", { phone, pin: PIN, shop_name: "Device Test" });
  const device = deviceCookie(signup).split(";")[0];

  const again = await post("/v1/auth/login", { phone, pin: PIN }, device);
  check("a known device is not issued a second token", again.status === 200 && !deviceCookie(again), again.status);

  const wrong = [];
  for (let i = 0; i < 5; i++) wrong.push((await post("/v1/auth/login", { phone, pin: "000002" }, device)).status);
  const after = await post("/v1/auth/login", { phone, pin: PIN }, device);
  check("five wrong PINs from a trusted device revoke its token", wrong.every((s) => s === 401) && after.status === 200 && Boolean(deviceCookie(after)), { wrong, after: after.status });
}

console.log(`\n${passed} checks passed.`);
