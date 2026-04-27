import { expect, test, type Page } from "@playwright/test";
import { seedMerchantSession } from "./helpers/fixtures";

async function mockSettingsApis(page: Page) {
  await page.route("**/api/merchant-branding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        branding_config: {
          primary_color: "#5ef2c0",
          secondary_color: "#b8ffe2",
          background_color: "#050608",
          logo_url: null,
        },
      }),
    });
  });

  await page.route("**/api/webhook-settings", async (route) => {
    const method = route.request().method();

    if (method === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          webhook_url: "https://example.com/webhooks/stellar",
          webhook_domain_verification: {
            status: "unverified",
            domain: "example.com",
            verification_token: "token_123",
            verification_file_url:
              "https://example.com/.well-known/pluto-verification.txt",
            checked_at: null,
            verified_at: null,
            failure_reason: null,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        webhook_url: "https://example.com/webhooks/stellar",
        webhook_secret_masked: "whsec_1234********5678",
        webhook_domain_verification: {
          status: "unverified",
          domain: "example.com",
          verification_token: "token_123",
          verification_file_url:
            "https://example.com/.well-known/pluto-verification.txt",
          checked_at: null,
          verified_at: null,
          failure_reason: null,
        },
      }),
    });
  });

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
}

test.describe("Settings screen reader support", () => {
  test.beforeEach(async ({ page }) => {
    await seedMerchantSession(page);
    await mockSettingsApis(page);
  });

  test("supports roving keyboard navigation across tabs", async ({ page }) => {
    await page.goto("/settings");

    const apiTab = page.getByRole("tab", { name: "API Keys" });
    const brandingTab = page.getByRole("tab", { name: "Branding" });
    const dangerTab = page.getByRole("tab", { name: "Danger Zone" });

    await expect(apiTab).toHaveAttribute("aria-selected", "true");
    await expect(apiTab).toHaveAttribute("tabindex", "0");

    await apiTab.focus();
    await page.keyboard.press("ArrowRight");

    await expect(brandingTab).toBeFocused();
    await expect(brandingTab).toHaveAttribute("aria-selected", "true");
    await expect(brandingTab).toHaveAttribute("tabindex", "0");
    await expect(apiTab).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("tabpanel", { name: "Branding" })).toBeVisible();

    await page.keyboard.press("End");
    await expect(dangerTab).toBeFocused();
    await expect(dangerTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Danger Zone" })).toBeVisible();

    await page.keyboard.press("Home");
    await expect(apiTab).toBeFocused();
    await expect(apiTab).toHaveAttribute("aria-selected", "true");
  });

  test("announces webhook URL validation errors through accessible form semantics", async ({
    page,
  }) => {
    await page.goto("/settings");

    const apiTab = page.getByRole("tab", { name: "API Keys" });
    await apiTab.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Webhooks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const webhookInput = page.getByLabel("Endpoint URL");
    await webhookInput.fill("http://example.com/webhook");

    await expect(webhookInput).toHaveAttribute("aria-invalid", "true");
    await expect(webhookInput).toHaveAttribute(
      "aria-describedby",
      "webhook-url-error",
    );
    await expect(page.locator("#webhook-url-error")).toContainText(
      "Webhook URL must use HTTPS",
    );
  });
});
