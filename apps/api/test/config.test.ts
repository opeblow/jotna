import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  DATABASE_URL: "postgres://jotna:test@localhost:5432/jotna",
  SECRETS_KEY: "ab".repeat(32),
};

const production = (overrides: NodeJS.ProcessEnv = {}) =>
  loadConfig({
    ...required,
    NODE_ENV: "production",
    NETWORK: "mainnet",
    WEB_ORIGIN: "https://jotna.example",
    ...overrides,
  });

describe("runtime configuration", () => {
  it("does not trust forwarded proxy headers by default", () => {
    expect(loadConfig({ ...required, NODE_ENV: "test" }).TRUST_PROXY).toBe(false);
  });

  it("accepts an explicitly configured production deployment", () => {
    expect(production().isProd).toBe(true);
  });

  it("rejects insecure or non-origin web URLs in production", () => {
    expect(() => production({ WEB_ORIGIN: "http://jotna.example" })).toThrow("HTTPS origin");
    expect(() => production({ WEB_ORIGIN: "https://jotna.example/app" })).toThrow("HTTPS origin");
  });

  it("rejects regtest and development wallet settings in production", () => {
    expect(() => production({ NETWORK: "regtest" })).toThrow("regtest network");
    expect(() => production({ DEV_BUYER_LND_URL: "http://127.0.0.1:8082" })).toThrow("development buyer wallet");
    expect(() => production({ DEV_BUYER_LND_MACAROON: "test" })).toThrow("development buyer wallet");
  });

  it("rejects private endpoints and spend-capable wallets in production", () => {
    expect(() => production({ ALLOW_PRIVATE_WALLET_HOSTS: "true" })).toThrow("private wallet hosts");
    expect(() => production({ ALLOW_SPEND_CAPABLE_WALLETS: "true" })).toThrow("spend-capable wallets");
  });
});
