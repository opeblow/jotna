import { pino } from "pino";
import { loadConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { RateService } from "./domain/rates.js";
import { WalletRegistry } from "./domain/wallets.js";
import { buildServer } from "./http/server.js";
import { loggerOptions } from "./lib/logger.js";
import { startWorker } from "./worker/worker.js";

const mode = process.argv[2] ?? "all"; // all | api | worker

const config = loadConfig();
const log = pino(loggerOptions(config.LOG_LEVEL));
const sql = createDb(config.DATABASE_URL);

const applied = await migrate(sql);
if (applied.length) log.info({ applied }, "migrations applied");

const ctx: AppContext = { config, sql, log, wallets: new WalletRegistry(sql, config), rates: new RateService(log) };

const app = mode !== "worker" ? await buildServer(ctx) : null;
const worker = mode === "worker" || (mode === "all" && config.WORKER_INLINE) ? startWorker(ctx) : null;

if (app) await app.listen({ host: config.HOST, port: config.PORT });
log.info({ mode, network: config.NETWORK }, "jotna is up");

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log.info({ signal }, "shutting down");
  await app?.close();
  await worker?.stop();
  ctx.wallets.closeAll();
  await sql.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
