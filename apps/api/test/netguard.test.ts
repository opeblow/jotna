import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateAddress, resolvePublicAddress } from "../src/lib/netguard.js";

describe("wallet endpoint network guard", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.8", "169.254.1.1"])(
    "identifies private address %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );

  it("allows a public IP address", async () => {
    await expect(resolvePublicAddress("8.8.8.8")).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });

  it("rejects a host that resolves to loopback", async () => {
    await expect(resolvePublicAddress("localhost")).rejects.toThrow("public addresses");
  });

  it("allows private hosts only when explicitly configured", async () => {
    await expect(resolvePublicAddress("127.0.0.1", true)).resolves.toEqual({ address: "127.0.0.1", family: 4 });
    await expect(resolvePublicAddress("127.0.0.1")).rejects.toThrow("public addresses");
  });

  it("rejects private wallet URLs before connecting", async () => {
    await expect(
      assertSafeUrl("http://127.0.0.1:8080", { protocols: ["http:"], allowPrivate: false }),
    ).rejects.toMatchObject({ code: "private_host" });
  });
});
