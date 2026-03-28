import { expect, test } from "@playwright/test";
import {
  checkoutPaymentId,
  expectNoHorizontalOverflow,
  mockCheckoutPayment,
  prepareVisualSnapshot,
} from "./helpers/fixtures";

test.describe("Checkout Visual Regression", () => {
  test.beforeEach(async ({ page }) => {
    await mockCheckoutPayment(page);
    await page.goto(`/pay/${checkoutPaymentId}`);
    await prepareVisualSnapshot(page);
  });

  test("checkout layout remains stable across viewports", async ({ page }) => {
    const checkoutMain = page.locator("main");
    await expect(checkoutMain).toBeVisible();
    await expect(page.getByText("Complete Payment")).toBeVisible();
    await expect(page.getByText("Styled payment")).toBeVisible();

    const noOverflow = await expectNoHorizontalOverflow(page);
    expect(noOverflow).toBeTruthy();

    await expect(checkoutMain).toHaveScreenshot("checkout-page.png");
  });
});
