import { expect, test, type Page } from "@playwright/test";

const MERCHANT_API_KEY = "sk_test_tooltip_responsiveness_key";

async function seedMerchantSession(page: Page) {
  await page.addInitScript(
    ({ apiKey, token }) => {
      window.localStorage.setItem("merchant_api_key", apiKey);
      window.localStorage.setItem("merchant_token", token);
      document.cookie = "NEXT_LOCALE=en; path=/";
    },
    {
      apiKey: MERCHANT_API_KEY,
      token: "eyJhbGciOiJub25lIn0.eyJpZCI6InRlc3QtaWQiLCJlbWFpbCI6InRlc3RAdGx1dG8uY2MiLCJleHAiOjE3NzY5ODI2ODl9.",
    },
  );
}

async function mockHealthApi(page: Page) {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
}

test.describe("Tooltip responsiveness", () => {
  test.beforeEach(async ({ page }) => {
    await seedMerchantSession(page);
    await mockHealthApi(page);
  });

  test("shows tooltip content and keeps it inside the viewport", async ({ page }) => {
    await page.goto("/dashboard/create");

    const tooltipButton = page.getByRole("button", { name: "More information" }).first();
    await tooltipButton.click();

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 10000 });

    const box = await tooltip.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);

    await expect(tooltip).toHaveCSS("background-color", "rgba(255, 255, 255, 0.95)");
  });
});
