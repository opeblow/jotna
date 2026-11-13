import { expect, test } from "@playwright/test";

test("home page presents the escrow flow and a shop CTA", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Paid at the door");
  await expect(page.getByRole("link", { name: "Open my shop" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#how");
});

test("shop signup explains the self-created PIN and validates required fields", async ({ page }) => {
  await page.goto("/start");

  const createShop = page.getByRole("button", { name: "Open my shop" });
  await expect(createShop).toBeDisabled();
  await expect(page.getByText("Create this code yourself; it will not be sent by SMS. Avoid 123456.")).toBeVisible();

  await page.getByLabel("Shop name").fill("Atelier Ndeye");
  await page.getByLabel("Phone number").fill("771234567");
  await page.getByLabel("6-digit secret code").fill("739104");
  await expect(page.getByLabel("Shop name")).toHaveValue("Atelier Ndeye");
  await expect(page.getByLabel("Phone number")).toHaveValue("771234567");
  await expect(page.getByLabel("6-digit secret code")).toHaveValue("739104");
  await expect(createShop).toBeEnabled();
});

test("login requires a phone number and six-digit PIN", async ({ page }) => {
  await page.goto("/login");

  const signIn = page.getByRole("button", { name: "Sign in" });
  await expect(signIn).toBeDisabled();
  await page.getByLabel("Phone number").fill("771234567");
  await page.getByLabel("6-digit secret code").fill("739104");
  await expect(page.getByLabel("Phone number")).toHaveValue("771234567");
  await expect(page.getByLabel("6-digit secret code")).toHaveValue("739104");
  await expect(signIn).toBeEnabled();
});
