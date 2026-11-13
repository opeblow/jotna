import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { LndProvider } from "../src/lightning/lnd.js";

const servers: ReturnType<typeof createServer>[] = [];
const providers: LndProvider[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.close();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })),
  );
});

async function localServer(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local server did not bind a TCP port");
  return { server, port: address.port };
}

describe("LND endpoint transport", () => {
  it("rechecks DNS results before opening a socket", async () => {
    let requests = 0;
    const { port } = await localServer((_req, res) => {
      requests++;
      res.end("{}");
    });
    const provider = new LndProvider({ restUrl: `http://localhost:${port}`, macaroonHex: "00" });
    providers.push(provider);

    await expect(provider.getInfo()).rejects.toThrow("LND unreachable");
    expect(requests).toBe(0);
  });

  it("does not follow redirects from a wallet endpoint", async () => {
    let requests = 0;
    const { port } = await localServer((_req, res) => {
      requests++;
      res.writeHead(302, { location: "/redirected" });
      res.end();
    });
    const provider = new LndProvider({
      restUrl: `http://127.0.0.1:${port}`,
      macaroonHex: "00",
      allowPrivateHosts: true,
    });
    providers.push(provider);

    await expect(provider.getInfo()).rejects.toThrow("LND unreachable");
    expect(requests).toBe(1);
  });
});
