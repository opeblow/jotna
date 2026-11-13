// Local stack without Docker: PostgreSQL, bitcoind (regtest) and two LND nodes with a funded channel.
//
//   node scripts/dev-stack.mjs
//
// Set JOTNA_DATA_DIR to keep a test stack separate from the default .data directory.
// Binaries are expected in .tools/ (see README, "Running without Docker"). State lives in .data/.
// On first run this also writes .env with fresh secrets and the regtest node credentials.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.JOTNA_DATA_DIR ? resolve(process.env.JOTNA_DATA_DIR) : join(ROOT, ".data");
const TOOLS = join(ROOT, ".tools");
const exe = process.platform === "win32" ? ".exe" : "";

const PORTS = { pg: 54329, btcRpc: 18443, zmqBlock: 28332, zmqTx: 28333, sellerRest: 8081, buyerRest: 8082 };
const RPC = { user: "jotna", pass: "jotna-regtest" };

function findBinary(name) {
  const stack = [TOOLS];
  while (stack.length) {
    const dir = stack.pop();
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.name === name + exe) return p;
    }
  }
  throw new Error(`${name}${exe} not found under .tools/. See README, "Running without Docker".`);
}

const children = [];
function run(label, bin, args) {
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  const log = (buf) => {
    if (process.env.VERBOSE) process.stdout.write(`[${label}] ${buf}`);
  };
  child.stdout.on("data", log);
  child.stderr.on("data", log);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`[${label}] exited with code ${code}`);
      void shutdown(1);
    }
  });
  children.push(child);
  return child;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeoutMs = 90_000) {
  const start = Date.now();
  let lastError = "";
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastError = err.message; // not ready yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}. ${lastError}`);
    await sleep(700);
  }
}

async function btc(method, params = [], wallet) {
  const res = await fetch(`http://127.0.0.1:${PORTS.btcRpc}/${wallet ? `wallet/${wallet}` : ""}`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${RPC.user}:${RPC.pass}`).toString("base64") },
    body: JSON.stringify({ jsonrpc: "1.0", id: "dev", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function lndClient(port, dir) {
  const macaroon = () => readFileSync(join(dir, "data/chain/bitcoin/regtest/admin.macaroon")).toString("hex");
  return async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Grpc-Metadata-macaroon": macaroon(), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`lnd ${path}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
}

let shuttingDown = false;
let pg;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping the local stack…");
  for (const child of children.reverse()) child.kill();
  await pg?.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => void shutdown());
process.on("uncaughtException", (err) => {
  console.error(err?.message ?? err ?? "The local stack failed to start");
  void shutdown(1);
});
process.on("unhandledRejection", (err) => {
  console.error(err?.message ?? err);
  void shutdown(1);
});
process.on("SIGTERM", () => void shutdown());

// ---- PostgreSQL ------------------------------------------------------------------------------
mkdirSync(DATA, { recursive: true });
const pgDir = join(DATA, "pg");
const firstPg = !existsSync(join(pgDir, "PG_VERSION"));
// A previous run that was killed can leave PostgreSQL running; stop it before starting our own.
if (existsSync(join(pgDir, "postmaster.pid"))) {
  const pgCtl = join(ROOT, "node_modules/@embedded-postgres", `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`, "native/bin", "pg_ctl" + exe);
  if (existsSync(pgCtl)) spawnSync(pgCtl, ["stop", "-D", pgDir, "-m", "fast", "-w"], { stdio: "ignore" });
}
pg = new EmbeddedPostgres({ databaseDir: pgDir, user: "jotna", password: "jotna", port: PORTS.pg, persistent: true, onLog: () => {} });
if (firstPg) await pg.initialise();
await pg.start();
if (firstPg) await pg.createDatabase("jotna");
console.log(`✓ PostgreSQL on :${PORTS.pg}`);

// ---- bitcoind --------------------------------------------------------------------------------
const btcDir = join(DATA, "bitcoin");
mkdirSync(btcDir, { recursive: true });
run("bitcoind", findBinary("bitcoind"), [
  "-regtest", `-datadir=${btcDir}`, "-server=1", "-listen=0", "-txindex=0", "-fallbackfee=0.0002",
  `-rpcuser=${RPC.user}`, `-rpcpassword=${RPC.pass}`, `-rpcport=${PORTS.btcRpc}`, "-rpcbind=127.0.0.1", "-rpcallowip=127.0.0.1",
  `-zmqpubrawblock=tcp://127.0.0.1:${PORTS.zmqBlock}`, `-zmqpubrawtx=tcp://127.0.0.1:${PORTS.zmqTx}`,
]);
await until("bitcoind", () => btc("getblockchaininfo"));
const wallets = await btc("listwallets");
if (!wallets.includes("miner")) {
  await btc("createwallet", ["miner"]).catch(() => btc("loadwallet", ["miner"]));
}
const minerAddress = await btc("getnewaddress", [], "miner");
const mine = (n) => btc("generatetoaddress", [n, minerAddress]);
if ((await btc("getblockcount")) < 101) await mine(101);
console.log("✓ bitcoind (regtest)");

// ---- LND nodes -------------------------------------------------------------------------------
function startLnd(name, restPort, rpcPort, p2pPort) {
  const dir = join(DATA, `lnd-${name}`);
  mkdirSync(dir, { recursive: true });
  run(`lnd-${name}`, findBinary("lnd"), [
    `--lnddir=${dir}`, "--noseedbackup", `--alias=jotna-${name}`, "--bitcoin.regtest", "--bitcoin.node=bitcoind",
    `--bitcoind.rpchost=127.0.0.1:${PORTS.btcRpc}`, `--bitcoind.rpcuser=${RPC.user}`, `--bitcoind.rpcpass=${RPC.pass}`,
    `--bitcoind.zmqpubrawblock=tcp://127.0.0.1:${PORTS.zmqBlock}`, `--bitcoind.zmqpubrawtx=tcp://127.0.0.1:${PORTS.zmqTx}`,
    `--rpclisten=127.0.0.1:${rpcPort}`, `--restlisten=127.0.0.1:${restPort}`, `--listen=127.0.0.1:${p2pPort}`,
    "--no-rest-tls", "--debuglevel=warn",
  ]);
  return { dir, call: lndClient(restPort, dir), p2pPort };
}
const seller = startLnd("seller", PORTS.sellerRest, 10009, 9735);
const buyer = startLnd("buyer", PORTS.buyerRest, 10010, 9736);
// After a restart LND only reports itself synced once it sees a fresh block, so mine while waiting.
let lastNudge = Date.now();
const synced = (node) =>
  until("lnd", async () => {
    const info = await node.call("GET", "/v1/getinfo").catch(() => null);
    if (info?.synced_to_chain) return true;
    if (Date.now() - lastNudge > 5000) {
      lastNudge = Date.now();
      await mine(1);
    }
    return false;
  }, 180_000);
await Promise.all([synced(seller), synced(buyer)]);
console.log("✓ LND seller and buyer nodes");

// ---- Channel: buyer → seller, so the buyer can pay ---------------------------------------------
const sellerInfo = await seller.call("GET", "/v1/getinfo");
const hasChannel = async () => ((await buyer.call("GET", "/v1/channels")).channels ?? []).some((c) => c.active);
if (!(await hasChannel())) {
  const { address } = await buyer.call("GET", "/v1/newaddress?type=WITNESS_PUBKEY_HASH");
  await btc("sendtoaddress", [address, 2], "miner");
  await mine(3);
  await until("buyer funds", async () => Number((await buyer.call("GET", "/v1/balance/blockchain")).confirmed_balance) > 0);
  await buyer
    .call("POST", "/v1/peers", { addr: { pubkey: sellerInfo.identity_pubkey, host: `127.0.0.1:${seller.p2pPort}` } })
    .catch((e) => {
      if (!/already connected/.test(e.message)) throw e;
    });
  const pending = (await buyer.call("GET", "/v1/channels/pending")).pending_open_channels ?? [];
  if (pending.length === 0) {
    await until("channel open", () =>
      buyer.call("POST", "/v1/channels", { node_pubkey_string: sellerInfo.identity_pubkey, local_funding_amount: "10000000" }).then(() => true),
    );
  }
  await mine(6);
  await until("channel active", async () => {
    if (await hasChannel()) return true;
    await mine(1);
    return false;
  });
}
console.log("✓ Lightning channel buyer → seller (0.1 BTC)");

// ---- .env --------------------------------------------------------------------------------------
const macaroon = (node, name) => readFileSync(join(node.dir, `data/chain/bitcoin/regtest/${name}.macaroon`)).toString("hex");
// Least privilege: exactly what Jotna needs (node info + invoices), nothing that can move funds.
// Equivalent to: lncli bakemacaroon info:read invoices:read invoices:write
const receiveOnly = await seller.call("POST", "/v1/macaroon", {
  permissions: [
    { entity: "info", action: "read" },
    { entity: "invoices", action: "read" },
    { entity: "invoices", action: "write" },
  ],
});
const envPath = join(ROOT, ".env");
const previous = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const keep = (key, fallback) => previous.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1] ?? fallback;
const env = {
  NODE_ENV: "development",
  DATABASE_URL: `postgres://jotna:jotna@127.0.0.1:${PORTS.pg}/jotna`,
  WEB_ORIGIN: keep("WEB_ORIGIN", "http://localhost:3000"),
  SECRETS_KEY: keep("SECRETS_KEY", randomBytes(32).toString("hex")),
  NETWORK: "regtest",
  ENABLE_LND_CONNECT: "true",
  ALLOW_PRIVATE_WALLET_HOSTS: "true",
  NOSTR_SECRET_KEY: keep("NOSTR_SECRET_KEY", randomBytes(32).toString("hex")),
  NOSTR_RELAYS: keep("NOSTR_RELAYS", ""),
  ANTHROPIC_API_KEY: keep("ANTHROPIC_API_KEY", ""),
  DEV_BUYER_LND_URL: `http://127.0.0.1:${PORTS.buyerRest}`,
  DEV_BUYER_LND_MACAROON: macaroon(buyer, "admin"),
  // Used by the seed script: the seller connects with a receive-only macaroon, which cannot spend.
  SEED_SELLER_LND_URL: `http://127.0.0.1:${PORTS.sellerRest}`,
  SEED_SELLER_LND_MACAROON: receiveOnly.macaroon,
};
writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
console.log("✓ .env written\n\nThe local stack is running. Leave this window open, then in another terminal:\n  npm run dev\n");

// Regtest has no miners: produce a block every 30 s so HTLC timeouts behave like a live network.
setInterval(() => void mine(1).catch(() => {}), 30_000);
