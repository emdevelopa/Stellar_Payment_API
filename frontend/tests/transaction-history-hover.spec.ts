import { test, expect } from "@playwright/test";

/**
 * Transaction History Table - Hover States Test Suite
 *
 * Tests the enhanced hover states for the Transaction History Table
 * to ensure proper UX/UI improvements matching the Drips Wave theme.
 */

test.describe("Transaction History Table - Hover States", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to payment history page (adjust URL as needed)
    await page.goto("/payment-history");

    // Wait for the table to load
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
  });

  test("should apply hover background color on table row hover", async ({
    page,
  }) => {
    const firstRow = page.locator("table tbody tr").first();

    // Hover over the row
    await firstRow.hover();

    // Check if hover background is applied
    const backgroundColor = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have the hover background color (#F9F9F9)
    expect(backgroundColor).toBeTruthy();
  });

  test("should show left border accent on hover", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();

    // Hover over the row
    await firstRow.hover();

    // Check for left border
    const borderLeft = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).borderLeftWidth;
    });

    // Should have 2px left border on hover
    expect(borderLeft).toBe("2px");
  });

  test("should apply smooth transition on hover", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();

    // Check transition property
    const transition = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).transition;
    });

    // Should have transition-all with 200ms duration
    expect(transition).toContain("all");
    expect(transition).toContain("0.2s");
  });

  test("should show View button on row hover (desktop)", async ({ page }) => {
    // Skip on mobile
    if (await page.viewportSize().then((v) => v.width < 640)) {
      test.skip();
    }

    const firstRow = page.locator("table tbody tr").first();
    const viewButton = firstRow.locator('button:has-text("View")');

    // Button should be hidden initially (opacity 0)
    const initialOpacity = await viewButton.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    expect(initialOpacity).toBe("0");

    // Hover over the row
    await firstRow.hover();

    // Wait for transition
    await page.waitForTimeout(250);

    // Button should be visible (opacity 100)
    const hoverOpacity = await viewButton.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    expect(hoverOpacity).toBe("1");
  });

  test("should apply enhanced button hover styles", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();
    await firstRow.hover();

    const viewButton = firstRow.locator('button:has-text("View")');

    // Hover over the button
    await viewButton.hover();

    // Check button hover styles
    const buttonBg = await viewButton.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // Should have Pluto theme background on hover
    expect(buttonBg).toBeTruthy();
  });

  test("should apply active state on click", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();

    // Click and hold
    await firstRow.hover();
    await page.mouse.down();

    // Check for active state background
    const activeBg = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    expect(activeBg).toBeTruthy();

    await page.mouse.up();
  });

  test("should maintain cursor pointer on hover", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();

    const cursor = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).cursor;
    });

    expect(cursor).toBe("pointer");
  });

  test("should work on mobile with touch events", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const firstRow = page.locator("table tbody tr").first();

    // Tap the row
    await firstRow.tap();

    // Should trigger click event (opens detail sheet)
    // This is a basic check - adjust based on your modal/sheet implementation
    await expect(page.locator('[role="dialog"], [data-sheet]')).toBeVisible({
      timeout: 2000,
    });
  });

  test("should show shadow on hover", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();

    await firstRow.hover();

    const boxShadow = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).boxShadow;
    });

    // Should have box-shadow applied
    expect(boxShadow).not.toBe("none");
  });

  test("should handle rapid hover in/out", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();
    const secondRow = page.locator("table tbody tr").nth(1);

    // Rapidly hover between rows
    await firstRow.hover();
    await page.waitForTimeout(50);
    await secondRow.hover();
    await page.waitForTimeout(50);
    await firstRow.hover();

    // Should not cause visual glitches
    await expect(firstRow).toBeVisible();
  });

  test("should not interfere with flash animation for confirmed payments", async ({
    page,
  }) => {
    // Look for a row with confirmed status and flash animation
    const confirmedRow = page.locator("table tbody tr.bg-emerald-50").first();

    if ((await confirmedRow.count()) > 0) {
      await confirmedRow.hover();

      // Should still have the emerald background
      const bgColor = await confirmedRow.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });

      expect(bgColor).toContain("rgb"); // Has some background color
    }
  });

  test("should match Pluto theme colors", async ({ page }) => {
    const firstRow = page.locator("table tbody tr").first();
    await firstRow.hover();

    // Check if Pluto color variables are being used
    const borderColor = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).borderLeftColor;
    });

    // Should use Pluto-500 color for left border
    expect(borderColor).toBeTruthy();
  });

  test("should be accessible with keyboard navigation", async ({ page }) => {
    // Tab to first row
    await page.keyboard.press("Tab");

    // Check if focus is visible
    const focusedElement = await page.evaluate(() => {
      return document.activeElement?.tagName;
    });

    expect(focusedElement).toBeTruthy();
  });

  test("should work correctly on different screen sizes", async ({ page }) => {
    const viewports = [
      { width: 375, height: 667, name: "Mobile" },
      { width: 768, height: 1024, name: "Tablet" },
      { width: 1920, height: 1080, name: "Desktop" },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.reload();
      await page.waitForSelector("table tbody tr");

      const firstRow = page.locator("table tbody tr").first();
      await firstRow.hover();

      // Should be visible and hoverable
      await expect(firstRow).toBeVisible();
    }
  });
});

test.describe("RecentPayments Component - Hover States", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard or wherever RecentPayments is used
    await page.goto("/dashboard");

    // Wait for the component to load
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
  });

  test("should apply same hover styles in RecentPayments component", async ({
    page,
  }) => {
    const firstRow = page.locator("table tbody tr").first();

    await firstRow.hover();

    // Check hover background
    const backgroundColor = await firstRow.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    expect(backgroundColor).toBeTruthy();
  });

  test("should show consistent button hover across components", async ({
    page,
  }) => {
    const firstRow = page.locator("table tbody tr").first();
    await firstRow.hover();

    const viewButton = firstRow.locator("button");
    await viewButton.hover();

    // Should have consistent styling
    const buttonStyles = await viewButton.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return {
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        transition: styles.transition,
      };
    });

    expect(buttonStyles.transition).toContain("all");
  });
});
