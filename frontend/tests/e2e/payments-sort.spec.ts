import { expect, test, type Page } from "@playwright/test";

const API_KEY = "sk_test_sorting_key";
const MERCHANT_ID = "merchant_sorting_demo";

const paymentsResponse = {
  payments: [
    {
      id: "pay_003",
      amount: "250.00",
      asset: "USDC",
      recipient: "GBETA3RECIPIENT111111111111111111111111111111111111111111",
      status: "confirmed",
      description: "Agency invoice",
      created_at: "2026-03-24T16:05:00.000Z",
    },
    {
      id: "pay_001",
      amount: "49.99",
      asset: "XLM",
      recipient: "GAMMA1RECIPIENT111111111111111111111111111111111111111111",
      status: "pending",
      description: "Starter plan",
      created_at: "2026-03-26T13:40:00.000Z",
    },
    {
      id: "pay_002",
      amount: "125.50",
      asset: "USDC",
      recipient: "GALPHA2RECIPIENT11111111111111111111111111111111111111111",
      status: "failed",
      description: "Pro subscription",
      created_at: "2026-03-25T09:15:00.000Z",
    },
  ],
  total_count: 3,
};

async function seedMerchantSession(page: Page) {
  await page.addInitScript(
    ({ apiKey, merchantId }) => {
      const payload = btoa(
        JSON.stringify({
          id: merchantId,
          email: "merchant@example.com",
          exp: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
      );

      window.localStorage.setItem("merchant_api_key", apiKey);
      window.localStorage.setItem(
        "merchant_token",
        `header.${payload}.signature`,
      );
      window.localStorage.setItem(
        "merchant_metadata",
        JSON.stringify({
          id: merchantId,
          email: "merchant@example.com",
          business_name: "Sort Demo",
          notification_email: "merchant@example.com",
          api_key: apiKey,
          webhook_secret: "whsec_demo",
          created_at: "2026-03-24T00:00:00.000Z",
        }),
      );
      document.cookie = "NEXT_LOCALE=en; path=/";
    },
    { apiKey: API_KEY, merchantId: MERCHANT_ID },
  );
}

async function mockPayments(page: Page) {
  await page.route("**/api/payments?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(paymentsResponse),
    });
  });
}

test.describe("Payments table sorting", () => {
  test.beforeEach(async ({ page }) => {
    await seedMerchantSession(page);
    await mockPayments(page);
  });

  test("sorts by date descending by default", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();

    const rows = page.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("49.99 XLM");
    await expect(rows.nth(1)).toContainText("125.50 USDC");
    await expect(rows.nth(2)).toContainText("250.00 USDC");
  });

  test("toggles amount sorting and persists query params", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();

    await page.getByRole("button", { name: /Amount/ }).click();
    await expect(page).toHaveURL(/sortColumn=amount/);
    await expect(page).toHaveURL(/sortDirection=asc/);

    const rows = page.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("49.99 XLM");
    await expect(rows.nth(1)).toContainText("125.50 USDC");
    await expect(rows.nth(2)).toContainText("250.00 USDC");

    await page.getByRole("button", { name: /Amount/ }).click();
    await expect(page).toHaveURL(/sortDirection=desc/);
    await expect(rows.nth(0)).toContainText("250.00 USDC");
    await expect(rows.nth(2)).toContainText("49.99 XLM");
  });

  test("sorts by recipient alphabetically", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();

    await page.getByRole("button", { name: /Recipient/ }).click();

    const rows = page.locator("tbody tr");
    await expect(rows.nth(0)).toContainText("125.50 USDC");
    await expect(rows.nth(1)).toContainText("250.00 USDC");
    await expect(rows.nth(2)).toContainText("49.99 XLM");
  });
});
