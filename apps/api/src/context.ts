import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Sql } from "./db/client.js";
import type { WalletRegistry } from "./domain/wallets.js";
import type { RateService } from "./domain/rates.js";

/** Everything a request handler or worker job needs. Passed explicitly; there are no globals. */
export interface AppContext {
  config: Config;
  sql: Sql;
  log: Logger;
  wallets: WalletRegistry;
  rates: RateService;
}
