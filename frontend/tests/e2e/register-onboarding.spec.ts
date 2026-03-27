import { expect, test } from "@playwright/test";

const API_BASE = "http://localhost:4000";

test.describe("registration onboarding redirect", () => {
  test("stores auth token, shows welcome toast, and redirects to dashboard", async ({
    page,
  }) => {
    const sessionToken = [
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0",
      "eyJtZXJjaGFudF9pZCI6Im1lcmNoYW50LTEiLCJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIiwiZXhwIjo0MTAyNDQ0ODAwfQ",
      "",
    ].join(".");

    await page.route(`${API_BASE}/api/register-merchant`, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Merchant registered successfully",
          token: sessionToken,
          merchant: {
            id: "merchant-1",
            email: "owner@example.com",
            business_name: "Stellar Shop",
            notification_email: "alerts@example.com",
            api_key: "sk_test_123",
            webhook_secret: "whsec_test_123",
            created_at: new Date().toISOString(),
          },
        }),
      });
    });

    await page.goto("/register");
    await page.getByLabel("Business Name").fill("Stellar Shop");
    await page.getByLabel("Primary Email").fill("owner@example.com");
    await page.getByLabel("Notification Email").fill("alerts@example.com");
    await page.getByRole("button", { name: "Register Merchant" }).click();

    await expect(page).toHaveURL("http://127.0.0.1:3000/dashboard");
    await expect(
      page.getByText("Welcome to Stellar Pay, Stellar Shop! Create your first payment to get started."),
    ).toBeVisible();

    const token = await page.evaluate(() =>
      window.localStorage.getItem("merchant_token"),
    );
    expect(token).toBe(sessionToken);
  });

  test("stays on register page when registration fails", async ({ page }) => {
    await page.route(`${API_BASE}/api/register-merchant`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Merchant with this email already exists",
        }),
      });
    });

    await page.goto("/register");
    await page.getByLabel("Business Name").fill("Stellar Shop");
    await page.getByLabel("Primary Email").fill("owner@example.com");
    await page.getByLabel("Notification Email").fill("alerts@example.com");
    await page.getByRole("button", { name: "Register Merchant" }).click();

    await expect(page).toHaveURL("http://127.0.0.1:3000/register");
    await expect(
      page.getByText("Merchant with this email already exists"),
    ).toBeVisible();
  });
});
