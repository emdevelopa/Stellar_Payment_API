import type { Page } from "@playwright/test";

const API_BASE = "http://localhost:4000";
const MERCHANT_TOKEN_KEY = "merchant_token";

function createMerchantToken() {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      id: merchantMetadata.id,
      email: merchantMetadata.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60,
    }),
  ).toString("base64url");

  return `${header}.${payload}.visual-test-signature`;
}

const merchantMetadata = {
  id: "merchant_test_123",
  email: "merchant@example.com",
  business_name: "Test Merchant",
  notification_email: "merchant@example.com",
  api_key: "sk_test_123",
  webhook_secret: "whsec_test_123",
  trusted_addresses: [
    {
      id: "addr_1",
      label: "Treasury Wallet",
      address: "GBZXN7PIRZGNMHGA6XSPU4IQQQ4JVCN6PWPB6T7N7CEJ5JQXBSV5Z5PX",
      created_at: "2026-03-27T00:00:00.000Z",
    },
  ],
  created_at: "2026-03-27T00:00:00.000Z",
};

export const checkoutPaymentId = "f4e8deaa-8a11-47b3-9b27-a95fa38374f4";

export async function seedMerchantSession(page: Page) {
  await stabilizeVisualTestPage(page);
  const token = createMerchantToken();
  await page.addInitScript((merchant) => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("merchant_token", merchant.token);
    localStorage.setItem("merchant_api_key", merchant.api_key);
    localStorage.setItem("merchant_metadata", JSON.stringify(merchant));
  }, { ...merchantMetadata, token });
}

export async function mockCheckoutPayment(page: Page, overrides: Record<string, unknown> = {}) {
  await stabilizeVisualTestPage(page);
  await page.route(`${API_BASE}/api/payment-status/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        payment: {
          id: checkoutPaymentId,
          amount: 10,
          asset: "XLM",
          asset_issuer: null,
          recipient: "GRECIPIENTADDRESS",
          description: "Styled payment",
          status: "pending",
          tx_id: null,
          created_at: "2026-03-27T00:00:00.000Z",
          branding_config: {
            primary_color: "#ff0066",
            secondary_color: "#ffd9e8",
            background_color: "#1b0b14",
          },
          ...overrides,
        },
      }),
    });
  });
}

export async function stabilizeVisualTestPage(page: Page) {
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
}

export async function prepareVisualSnapshot(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.documentElement.classList.add("dark");
    document.body.classList.add("dark");
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth <= root.clientWidth;
  });
}
