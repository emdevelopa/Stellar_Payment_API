import { test, expect } from "@playwright/test";

test.describe("Visual Regression Tests for Core Components", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the VRT component testing page
    await page.goto("/vrt");
    // Ensure the page is fully loaded and hydrated
    await page.waitForLoadState("networkidle");
  });

  test("Buttons should match visual baseline", async ({ page }) => {
    const buttonsSection = page.locator("#vrt-buttons");
    await expect(buttonsSection).toBeVisible();
    
    // Check match for buttons section which has primary, secondary, loading, disabled
    expect(await buttonsSection.screenshot()).toMatchSnapshot("buttons-core.png");
  });

  test("Inputs should match visual baseline", async ({ page }) => {
    const inputsSection = page.locator("#vrt-inputs");
    await expect(inputsSection).toBeVisible();

    // Fill an input dynamically to capture it
    const defaultInput = page.getByTestId("vrt-input-default");
    await defaultInput.fill("test@stellar.org");
    // Unfocus to remove active cursor from screenshot if desired
    await page.keyboard.press("Tab");

    // Check match for inputs section
    expect(await inputsSection.screenshot()).toMatchSnapshot("inputs-core.png");
  });

  test("Modals should match visual baseline", async ({ page }) => {
    // Click button to open modal
    const openBtn = page.getByTestId("open-modal-btn");
    await openBtn.click();

    // Check if modal backdrop and content are visible
    const modalContent = page.getByTestId("modal-content");
    await expect(modalContent).toBeVisible();

    // Give it a tiny moment to finish potential css transitions
    await page.waitForTimeout(300);

    // Snapshot the entire viewport because it's a modal overlay
    expect(await page.screenshot()).toMatchSnapshot("modal-core.png");
  });
});
