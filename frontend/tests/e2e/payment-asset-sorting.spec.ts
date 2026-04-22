import { expect, test } from "@playwright/test";

const API_BASE = "http://localhost:4000";
const PAYMENT_ID = "sorting-test-id";
const PAY_URL = `/pay/${PAYMENT_ID}`;
const SOURCE_PUBLIC_KEY = "GBRPYHIL2C7Q7PGLUKSTPIY2KPJ7QMZ4ZWJHQ6GUSIW2LQAHOMK5N7BI";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const PAYMENT = {
  id: PAYMENT_ID,
  amount: 10,
  asset: "USDC",
  asset_issuer: USDC_ISSUER,
  recipient: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  description: "Sorting Test",
  status: "pending",
  tx_id: null,
  created_at: new Date().toISOString(),
  branding_config: null,
};

test.describe("Payment Asset Sorting", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Freighter
    await page.addInitScript(
      ({ sourcePublicKey }) => {
        window.addEventListener("message", (event) => {
          if (event.source !== window) return;
          const data = event.data;
          if (data?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

          const respond = (payload: Record<string, unknown>) => {
            window.postMessage(
              {
                source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
                messagedId: data.messageId,
                ...payload,
              },
              window.location.origin,
            );
          };

          if (data.type === "REQUEST_ACCESS") respond({ publicKey: sourcePublicKey });
          if (data.type === "REQUEST_ALLOWED_STATUS") respond({ isAllowed: true });
        });
      },
      { sourcePublicKey: SOURCE_PUBLIC_KEY },
    );

    // Mock payment status
    await page.route(`${API_BASE}/api/payment-status/${PAYMENT_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payment: PAYMENT }) })
    );

    // Mock network fee
    await page.route(`${API_BASE}/api/network-fee`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          network_fee: { xlm: "0.00001", stroops: 100, operation_count: 1 }
        })
      })
    );
  });

  test("defaults to XLM when XLM balance is higher", async ({ page }) => {
    // Mock Horizon account (XLM: 100, USDC: 10)
    await page.route("**/accounts/" + SOURCE_PUBLIC_KEY, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          balances: [
            { asset_type: "native", balance: "100.0000000" },
            { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "10.0000000" },
          ],
        }),
      })
    );

    // Mock path quote for XLM -> USDC
    await page.route(`${API_BASE}/api/path-payment-quote/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          source_asset: "XLM",
          source_amount: "50.0000000",
          send_max: "50.5000000",
          destination_asset: "USDC",
          destination_amount: "10.0000000",
          path: [],
        }),
      })
    );

    await page.goto(PAY_URL);
    await page.getByRole("button", { name: /Freighter/i }).click();

    // Check dropdown default
    const select = page.locator("select");
    await expect(select).toHaveValue("XLM");
    
    // Check sorting: XLM should be first
    const options = page.locator("select option");
    await expect(options.nth(0)).toHaveText(/XLM/);
    await expect(options.nth(1)).toHaveText(/USDC/);

    // Verify path payment toggle is shown and checked
    await expect(page.getByText("Pay with 50.0000000 XLM instead")).toBeVisible();
  });

  test("defaults to USDC when USDC balance is higher for a USDC payment", async ({ page }) => {
    // Mock Horizon account (XLM: 10, USDC: 100)
    await page.route("**/accounts/" + SOURCE_PUBLIC_KEY, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          balances: [
            { asset_type: "native", balance: "10.0000000" },
            { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "100.0000000" },
          ],
        }),
      })
    );

    await page.goto(PAY_URL);
    await page.getByRole("button", { name: /Freighter/i }).click();

    // Check dropdown default
    const select = page.locator("select");
    await expect(select).toHaveValue("USDC");

    // Check sorting: USDC should be first
    const options = page.locator("select option");
    await expect(options.nth(0)).toHaveText(/USDC/);
    await expect(options.nth(1)).toHaveText(/XLM/);

    // Verify NO path payment toggle (since we pay USDC for a USDC invoice)
    await expect(page.getByText(/Pay with.*instead/)).not.toBeVisible();
  });
});
