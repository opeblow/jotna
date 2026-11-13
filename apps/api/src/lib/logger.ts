import type { LoggerOptions } from "pino";

/**
 * Log configuration shared by the HTTP server and the worker.
 * Secrets and personal data are removed at the logger, so a careless log call cannot leak them.
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        'req.headers["x-jotna-buyer"]',
        'res.headers["set-cookie"]',
        "*.pin",
        "*.phone",
        "*.preimage",
        "*.buyer_key",
        "*.connection_uri",
        "*.macaroon_hex",
        "*.secret_enc",
      ],
      censor: "[redacted]",
    },
  };
}
