import { expect, test, type Page } from "@playwright/test";
import { seedMerchantSession } from "./helpers/fixtures";

const API_BASE = "http://localhost:4000";

async function mockDashboardApis(page: Page) {
  await page.route(`${API_BASE}/api/metrics`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        metrics: {
          total_volume: {
            count: 1,
          },
        },
      }),
    });
  });

  await page.route(`${API_BASE}/api/metrics/7day`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [],
        total_volume: 125,
        total_payments: 1,
        confirmed_count: 1,
        success_rate: 100,
      }),
    });
  });

  await page.route(`${API_BASE}/api/metrics/volume?*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        range: "7D",
        assets: [],
        data: [],
      }),
    });
  });

  await page.route(`${API_BASE}/api/payments?*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payments: [],
        total_count: 0,
      }),
    });
  });

  await page.route(`${API_BASE}/api/health`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
}

test.describe("First payment celebration", () => {
  test("shows once for a merchant after the first successful payment and can be dismissed", async ({ page }) => {
    await seedMerchantSession(page);
    await mockDashboardApis(page);

    await page.goto("/dashboard");

    const dialog = page.getByRole("dialog", { name: "First payment received" });

    await expect(page.getByRole("heading", { name: "Merchant Hub" })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("link", { name: "Configure Webhooks" })).toBeVisible();

    await page.getByRole("button", { name: "I'll do it later" }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(dialog).toHaveCount(0);
  });
});
