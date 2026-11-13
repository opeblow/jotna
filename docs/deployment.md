# Production deployment

This guide is platform-neutral. Run the web app and API behind HTTPS, and keep the API and PostgreSQL private to the application network.

## Runtime requirements

- Node.js 22 or newer
- PostgreSQL with durable storage and automated backups
- A TLS-terminating reverse proxy or managed HTTPS ingress
- A Lightning node on the same network configured for hold invoices

Use signet for staging. The API rejects regtest, insecure web origins, private wallet hosts, spend-capable wallet connections, and the development buyer wallet when `NODE_ENV=production`.

## API configuration

Set these values in the deployment platform's secret/configuration manager. Do not commit production environment files.

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
WEB_ORIGIN=https://shop.example.com
DATABASE_URL=<provider-issued PostgreSQL URL with TLS>
SECRETS_KEY=<64 hex characters generated from 32 random bytes>
NETWORK=mainnet
ALLOW_PRIVATE_WALLET_HOSTS=false
ALLOW_SPEND_CAPABLE_WALLETS=false
TRUST_PROXY=false
WORKER_INLINE=true
```

Generate `SECRETS_KEY` once with a cryptographically secure random generator, for example:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex') + '\n')"
```

Back up this key in the same secure system as the database backups. Losing or changing it without re-encrypting wallet credentials makes those credentials unreadable.

`WEB_ORIGIN` must be the exact HTTPS origin, with no path or trailing slash. `NETWORK` must be explicitly set to the same network as connected wallets. Keep `DEV_BUYER_LND_URL` and `DEV_BUYER_LND_MACAROON` unset. Set `ENABLE_LND_CONNECT=true` only when direct LND wallet connections are part of the deployment.

`TRUST_PROXY` defaults to `false`. Keep it false unless the API is reachable only through a trusted proxy that overwrites forwarded headers; setting it to true while clients can reach the API directly allows them to spoof client IPs and bypass IP-based rate limits.

## Build and run

Install locked dependencies and run the same checks as CI:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Set `API_URL` to the API's internal HTTPS address in the web build environment. Next.js uses it for the server-side `/api` rewrite, so configure it before building the web app.

Run the API and web app using the package start commands:

```bash
npm --prefix apps/api start
npm --prefix apps/web start
```

The API applies database migrations during startup, so its database role needs the permissions required to create and update the application schema. Restrict PostgreSQL access to the application network and use the database provider's certificate-verified TLS connection settings.

The API exposes `/healthz` for liveness and `/readyz` for readiness; readiness also verifies the database connection. Configure the platform to restart unhealthy processes and alert on repeated restarts, worker failures, or database connectivity issues.

## Worker scaling

With one API instance, the default `WORKER_INLINE=true` runs the reconciliation worker alongside the API. For multiple API replicas, set `WORKER_INLINE=false` on API instances and run a dedicated worker process:

```bash
node apps/api/dist/main.js api
node apps/api/dist/main.js worker
```

The worker uses PostgreSQL row locking to coordinate work across instances. Keep worker processes on the same database and network as the API.

## Release checklist

- Deploy to signet first and exercise checkout, payment release, refunds, and timeout handling.
- Confirm HTTPS, cookie behavior, origin checks, and API ingress restrictions.
- Verify database backup restoration and protect the `SECRETS_KEY` backup.
- Confirm connected wallets are on the configured network and use invoice-only credentials.
- Keep secrets out of build logs, support tickets, and source control.
