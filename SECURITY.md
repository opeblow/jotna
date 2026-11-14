# Security policy

## Supported versions

The project currently supports the latest main branch and the latest release branch. Security updates are applied to the active development branch first.

## Reporting a vulnerability

Please report security issues privately and responsibly.

- Preferred: GitHub Security Advisories for the repository
- Alternative: email security@jotna.app

Do not disclose the issue publicly until we have had a chance to assess and remediate it.

## What to include

- Product area affected
- Clear reproduction steps
- Impact assessment
- Any proof-of-concept or exploit details
- Suggested mitigation if available

## Response expectations

We will acknowledge receipt within 5 business days and provide a remediation timeline once the issue is triaged.

## Security principles

- Do not custody user funds.
- Validate all inputs.
- Minimise wallet capabilities and connection exposure.
- Prefer auditable, deterministic state transitions.
- Keep secrets out of logs and debug output.

## Threat model

What an attacker might try, and what stops them. "Jotna" below means the server; the buyer's code is the secret generated on the buyer's device.

| Attack | Defence |
| --- | --- |
| Jotna, or someone who breaks into it, takes the money | The payment is locked to a hash whose preimage only the buyer's device knows. Without it nobody can settle. Wallet connections that can spend are refused, so the stored credential can only receive. |
| Seller collects without delivering | Settlement needs the buyer's code, which is shown at the door. If it is never shown, the payment is cancelled at the deadline, and the Lightning timeout returns it even if Jotna is offline. |
| Buyer takes the parcel without paying | The rider hands over only after their own screen says "Paid". |
| Buyer shows the rider a look-alike order from a shop they control | The seller gives the rider a 5-character order reference; the release screen shows it and the rider compares. A forged order has a different, random reference. |
| Stranger with the order link blocks the real buyer | Several devices may hold an unpaid invoice at once. The first payment to lock wins; the others are withdrawn at the seller's node. Unpaid invoices are capped per order. |
| Routing node replays the payment hash of someone's in-flight payment | A payment hash is accepted once, ever, and an invoice is never created or cancelled for a hash that already belongs to another attempt. |
| Seller clicks "dispatched" to stop the buyer cancelling, then never delivers | The cancel pause after dispatch is limited (`DISPATCH_GRACE_MINUTES`, 2 hours by default). |
| PIN guessing | Five wrong PINs lock the account for 15 minutes; predictable PINs are refused at sign-up; sign-in is rate limited per visitor and phone number. |
| Locking a seller out on purpose with wrong PINs | A device that has signed in before is exempt from the account lockout and has its own five-attempt budget. |
| Cross-site request forgery | `SameSite=Lax` session cookie, an Origin check and JSON-only bodies on every state-changing request. |
| Server-side request forgery through wallet addresses | Wallet hosts are resolved and must be public addresses, at connection time as well as when saved. Redirects are not followed. |
| Duplicate orders or double settlement from retries | `Idempotency-Key` on order creation; settlement and refund are write-ahead states with idempotent wallet calls, finished by the worker after a crash. |
| Leaking order links or secrets | Order links are never logged or published. Public receipts carry a one-way tag, not the order id, and no amounts. Secrets are redacted in logs. |

## Known limits

- **Phone numbers are verified only when Twilio is configured.** With the `TWILIO_*` variables set, sign-up requires a one-time code sent to the number (Twilio Verify generates and checks it; no code is stored by Jotna). Without them, anyone can register any number. Shop names are never verified, and there is no PIN reset by SMS yet.
- **Reputation can be self-dealt.** A seller can pay their own orders to add deliveries; it costs only routing fees.
- **A new device during a lockout must wait.** The trusted-device exemption only helps devices that signed in before.
- **A lost buyer device and a lost backup code** mean the payment cannot be released; it is refunded at the deadline.
- **Wallets other than LND are less tested.** The NWC path depends on the wallet's hold-invoice behaviour.
- **Rate limits need a correct `TRUST_PROXY`** and an ingress that sets the client address (see `docs/deployment.md`).
