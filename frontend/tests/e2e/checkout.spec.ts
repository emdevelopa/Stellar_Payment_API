
import { expect, test } from "@playwright/test";

const API_BASE = "http://localhost:4000";
const PAYMENT_ID = "c1a2b3d4-e5f6-7890-abcd-ef1234567890";
const PAY_URL = `/pay/${PAYMENT_ID}`;

const RECIPIENT = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZQE4N4BKGN6GTXLRA";

const BASE_PAYMENT = {
  id: PAYMENT_ID,
  amount: 10,
  asset: "XLM",
  asset_issuer: null as string | null,
  recipient: RECIPIENT,
  description: "Test payment",
  status: "pending",
  tx_id: null as string | null,
  created_at: "2024-06-01T12:00:00.000Z",
  branding_config: null as Record<string, string> | null,
};

async function mockPayment(
  page: import("@playwright/test").Page,
  overrides: Partial<typeof BASE_PAYMENT> = {}
) {
  await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ payment: { ...BASE_PAYMENT, ...overrides } }),
    })
  );
}

test.describe("Checkout – Rendering", () => {
  test("renders the page heading and payment request label", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText("Complete Payment")).toBeVisible();
    await expect(page.getByText("Payment Request")).toBeVisible();
  });

  test("renders the payment ID below the heading", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText(`ID: ${PAYMENT_ID}`)).toBeVisible();
  });

  test("renders the payment amount", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    // Amount is formatted via toLocaleString; "10" for a value of 10
    await expect(page.getByText("10", { exact: true })).toBeVisible();
  });

  test("renders the asset label next to the amount", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    // Asset label in the amount hero (text-2xl span)
    const assetLabel = page.locator("span.text-2xl").filter({ hasText: "XLM" });
    await expect(assetLabel).toBeVisible();
  });

  test("renders the payment description", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText("Test payment")).toBeVisible();
  });

  test("renders the recipient address", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText(RECIPIENT)).toBeVisible();
  });

  test("renders the recipient section label", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText("Recipient")).toBeVisible();
  });

  test("renders the created date label", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText("Created")).toBeVisible();
  });

  test("renders the XLM asset icon badge", async ({ page }) => {
    await mockPayment(page, { asset: "XLM" });
    await page.goto(PAY_URL);

    // XLM badge is a rounded span containing an SVG icon (aria-hidden)
    const xlmBadge = page.locator("span.rounded-full.bg-gradient-to-br svg");
    await expect(xlmBadge).toBeVisible();
  });

  test("renders the USDC asset badge with text", async ({ page }) => {
    await mockPayment(page, {
      asset: "USDC",
      asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    await page.goto(PAY_URL);

    // The USDC badge renders the text "USDC" inside a blue rounded span
    const usdcBadge = page.locator("span.bg-\\[\\#2775CA\\]");
    await expect(usdcBadge).toBeVisible();
    await expect(usdcBadge).toHaveText("USDC");
  });

  test("renders pending status badge", async ({ page }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Awaiting Payment")).toBeVisible();
  });

  test("renders confirmed status badge", async ({ page }) => {
    await mockPayment(page, { status: "confirmed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Confirmed")).toBeVisible();
  });

  test("renders completed status badge", async ({ page }) => {
    await mockPayment(page, { status: "completed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Completed")).toBeVisible();
  });

  test("renders failed status badge", async ({ page }) => {
    await mockPayment(page, { status: "failed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Failed")).toBeVisible();
  });

  test("shows settled success note for a confirmed payment", async ({ page }) => {
    await mockPayment(page, { status: "confirmed" });
    await page.goto(PAY_URL);

    await expect(
      page.getByText("Payment Received")
    ).toBeVisible();
    await expect(
      page.getByText("Your transaction was successfully confirmed and settled on the Stellar network.")
    ).toBeVisible();
  });

  test("shows settled success note for a completed payment", async ({ page }) => {
    await mockPayment(page, { status: "completed" });
    await page.goto(PAY_URL);

    await expect(
      page.getByText("Payment Received")
    ).toBeVisible();
  });

  test("shows receipt download action for settled payments", async ({ page }) => {
    await mockPayment(page, { status: "completed" });
    await page.goto(PAY_URL);

    await expect(
      page.getByRole("button", { name: "Download Receipt" })
    ).toBeVisible();
  });

  test("shows failed note for a failed payment", async ({ page }) => {
    await mockPayment(page, { status: "failed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("This payment has failed.")).toBeVisible();
    await expect(
      page.getByText("Contact the merchant if you believe this is an error.")
    ).toBeVisible();
  });

  test("shows transaction hash and explorer link when tx_id is present", async ({
    page,
  }) => {
    const txHash =
      "3b5e2a1f8c9d4e6f7a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";
    await mockPayment(page, { status: "completed", tx_id: txHash });
    await page.goto(PAY_URL);

    await expect(page.getByText("Transaction")).toBeVisible();
    await expect(page.getByText(txHash)).toBeVisible();

    const explorerLink = page.locator(`a[href*="${txHash}"]`);
    await expect(explorerLink).toBeVisible();
    await expect(explorerLink).toHaveAttribute("target", "_blank");
  });

  test("does not show transaction section when tx_id is null", async ({
    page,
  }) => {
    await mockPayment(page, { tx_id: null });
    await page.goto(PAY_URL);

    await expect(page.getByText("Transaction")).not.toBeVisible();
  });

  test("downloads a receipt PDF for a completed payment", async ({ page }) => {
    const txHash =
      "3b5e2a1f8c9d4e6f7a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";
    await mockPayment(page, { status: "completed", tx_id: txHash });
    await page.goto(PAY_URL);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Receipt" }).click();

    const download = await downloadPromise;
    expect(await download.suggestedFilename()).toBe(`receipt-${PAYMENT_ID}.pdf`);
  });
});

test.describe("Checkout – QR Code", () => {
  test("QR code section label is visible", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(page.getByText("Scan to Pay")).toBeVisible();
  });

  test("QR code SVG is rendered inside the white container", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    // QRCodeSVG renders an <svg> inside a white-background div
    const qrWrapper = page.locator("div.bg-white").first();
    await expect(qrWrapper).toBeVisible();

    const qrSvg = qrWrapper.locator("svg");
    await expect(qrSvg).toBeVisible();
  });

  test("QR code SVG has non-zero dimensions", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    const qrSvg = page.locator("div.bg-white").first().locator("svg");
    const box = await qrSvg.boundingBox();

    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });

  test("scan description text is visible", async ({ page }) => {
    await mockPayment(page);
    await page.goto(PAY_URL);

    await expect(
      page.getByText("Scan with Freighter or any Stellar wallet")
    ).toBeVisible();
  });
});

test.describe("Checkout – Wallet Selector", () => {
  test("wallet selector prompt is shown for a pending payment", async ({
    page,
  }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Choose a wallet")).toBeVisible();
  });

  test("Freighter wallet button is present", async ({ page }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    await expect(
      page.getByRole("button", { name: /Freighter/i })
    ).toBeVisible();
  });

  test("WalletConnect wallet button is present", async ({ page }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    await expect(
      page.getByRole("button", { name: /WalletConnect/i })
    ).toBeVisible();
  });

  test("Freighter button shows unavailable label when extension is not installed", async ({
    page,
  }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    // "(not installed)" appears next to the Freighter label in headless browsers
    await expect(page.getByText("(not installed)")).toBeVisible();
  });

  test("WalletConnect button shows unavailable label when project ID is missing", async ({
    page,
  }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    // "(no project ID)" appears when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is unset
    await expect(page.getByText("(no project ID)")).toBeVisible();
  });

  test("Freighter button is disabled in headless environment", async ({
    page,
  }) => {
    await mockPayment(page, { status: "pending" });
    await page.goto(PAY_URL);

    const freighterBtn = page.getByRole("button", { name: /Freighter/i });
    await expect(freighterBtn).toBeDisabled();
  });

  test("wallet selector is hidden when payment is confirmed", async ({
    page,
  }) => {
    await mockPayment(page, { status: "confirmed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Choose a wallet")).not.toBeVisible();
  });

  test("wallet selector is hidden when payment is completed", async ({
    page,
  }) => {
    await mockPayment(page, { status: "completed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Choose a wallet")).not.toBeVisible();
  });

  test("wallet selector is hidden when payment has failed", async ({ page }) => {
    await mockPayment(page, { status: "failed" });
    await page.goto(PAY_URL);

    await expect(page.getByText("Choose a wallet")).not.toBeVisible();
  });
});

test.describe("Checkout – Error Handling", () => {
  test("shows error title when the API returns 404", async ({ page }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Error")).toBeVisible();
  });

  test("shows 'Payment not found.' message on 404", async ({ page }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Payment not found.")).toBeVisible();
  });

  test("shows error description on 404", async ({ page }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto(PAY_URL);

    await expect(
      page.getByText(
        "Check the payment link and try again, or contact the sender."
      )
    ).toBeVisible();
  });

  test("shows error title when the API returns a server error (500)", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 500 })
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Error")).toBeVisible();
  });

  test("shows error state when the network request is aborted", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.abort("failed")
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Error")).toBeVisible();
  });

  test("does not render the checkout card in the error state", async ({
    page,
  }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Complete Payment")).not.toBeVisible();
  });

  test("does not render the QR code in the error state", async ({ page }) => {
    await page.route(`${API_BASE}/api/payment-status/**`, (route) =>
      route.fulfill({ status: 404 })
    );
    await page.goto(PAY_URL);

    await expect(page.getByText("Scan to Pay")).not.toBeVisible();
  });
});
