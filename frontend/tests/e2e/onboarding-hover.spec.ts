import { expect, test } from "@playwright/test";

test.describe("Onboarding Flow Hover States", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/register");
    await page.waitForLoadState("networkidle");
  });

  test("uses Pluto-themed hover states for onboarding fields and actions", async ({
    page,
  }) => {
    const businessNameInput = page.locator("#businessName");
    await businessNameInput.hover();

    await expect(businessNameInput).toHaveCSS(
      "border-top-color",
      "rgb(138, 175, 212)"
    );

    const boxShadow = await businessNameInput.evaluate((element) =>
      window.getComputedStyle(element).boxShadow
    );
    expect(boxShadow).not.toBe("none");

    await page.locator("#businessName").fill("Pluto Labs");
    await page.locator("#email").fill("owner@pluto.test");
    await page.locator("#notificationEmail").fill("alerts@pluto.test");
    await page.locator("#password").fill("VeryStrongPassword!123");

    const submitButton = page.getByRole("button", {
      name: "Create Professional Profile",
    });
    await expect(submitButton).toBeEnabled();
    await submitButton.hover();
    await expect(submitButton).toHaveCSS(
      "background-color",
      "rgb(45, 74, 122)"
    );

    const loginLink = page.getByRole("link", { name: "Log in here" });
    await loginLink.hover();
    await expect(loginLink).toHaveCSS("color", "rgb(61, 100, 148)");
  });
});
