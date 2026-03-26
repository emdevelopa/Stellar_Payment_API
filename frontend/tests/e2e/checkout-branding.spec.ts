import { expect, test } from "@playwright/test";

const API_BASE = "http://localhost:4000";

test("falls back to default checkout theme when branding is null", async ({ page }) => {
  await page.route(`${API_BASE}/api/payment-status/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payment: {
          id: "f4e8deaa-8a11-47b3-9b27-a95fa38374f4",
          amount: 10,
          asset: "XLM",
          asset_issuer: null,
          recipient: "GRECIPIENTADDRESS",
          description: "Test payment",
          status: "pending",
          tx_id: null,
          created_at: new Date().toISOString(),
          branding_config: null,
        },
      }),
    });
  });

  await page.goto("/pay/f4e8deaa-8a11-47b3-9b27-a95fa38374f4");
  await expect(page.getByText("Complete Payment")).toBeVisible();

  const checkoutPrimary = await page
    .locator("main")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--checkout-primary").trim());
  expect(checkoutPrimary).toBe("#5ef2c0");
});

test("renders checkout with custom session branding and matches snapshot", async ({ page }) => {
  await page.route(`${API_BASE}/api/payment-status/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payment: {
          id: "f4e8deaa-8a11-47b3-9b27-a95fa38374f4",
          amount: 10,
          asset: "XLM",
          asset_issuer: null,
          recipient: "GRECIPIENTADDRESS",
          description: "Styled payment",
          status: "pending",
          tx_id: null,
          created_at: new Date().toISOString(),
          branding_config: {
            primary_color: "#ff0066",
            secondary_color: "#ffd9e8",
            background_color: "#1b0b14",
          },
        },
      }),
    });
  });

  await page.goto("/pay/f4e8deaa-8a11-47b3-9b27-a95fa38374f4");
  await expect(page.getByText("Complete Payment")).toBeVisible();

  await expect(page).toHaveScreenshot("checkout-custom-branding.png", {
    fullPage: true,
  });
});
