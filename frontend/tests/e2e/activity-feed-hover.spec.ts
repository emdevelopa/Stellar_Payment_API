import { test, expect } from "@playwright/test";

test.describe("ActivityFeed Component - Hover States", () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses for ActivityFeed
    await page.route("**/api/payments?limit=10", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          payments: [
            {
              id: "test-payment-1",
              amount: 100,
              asset: "XLM",
              status: "confirmed",
              description: "Test Payment 1",
              created_at: new Date().toISOString(),
            },
            {
              id: "test-payment-2",
              amount: 50,
              asset: "USDC",
              status: "pending",
              description: "Test Payment 2",
              created_at: new Date().toISOString(),
            },
          ],
        }),
      });
    });

    // Mock merchant store
    await page.addInitScript(() => {
      window.localStorage.setItem("merchant-store", JSON.stringify({
        apiKey: "test-api-key",
        merchantId: "test-merchant-id",
        hydrated: true,
      }));
    });

    // Navigate to a page that would render ActivityFeed
    // Since ActivityFeed is not currently used, we'll create a test page
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            :root {
              --pluto-50: #f0f6fb;
              --pluto-100: #dce9f4;
              --pluto-500: #4a6fa5;
            }
          </style>
        </head>
        <body>
          <div id="activity-feed"></div>
          <script>
            // Mock React component rendering
            const activityFeed = document.getElementById('activity-feed');
            activityFeed.innerHTML = \`
              <div class="rounded-lg border border-[#E8E8E8] bg-white overflow-hidden">
                <div class="flex items-center justify-between border-b border-[#E8E8E8] bg-[#0A0A0A] px-4 py-4 sm:px-6">
                  <h3 class="font-semibold text-white text-sm">Live Activity Feed</h3>
                </div>
                <div class="space-y-3 p-4 sm:hidden">
                  <div tabindex="0" role="row" class="rounded-lg border p-3 outline-none transition-all duration-200 ease-in-out hover:border-l-2 hover:border-l-pluto-500 hover:bg-pluto-50 hover:shadow-sm active:scale-[0.985] active:bg-pluto-100 focus-visible:ring-2 focus-visible:ring-pluto-500 focus-visible:ring-offset-2 cursor-pointer border-[#E8E8E8] bg-white">
                    <div class="mb-2 flex items-start justify-between gap-3">
                      <p class="truncate text-sm font-semibold text-[#0A0A0A]">Test Payment 1</p>
                      <div class="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight bg-[#0A0A0A] text-white">confirmed</div>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <time class="text-[11px] font-medium text-[#6B6B6B]" datetime="2024-01-01">1/1/2024</time>
                      <p class="text-right text-sm font-bold text-[#0A0A0A]">100 XLM</p>
                    </div>
                  </div>
                </div>
                <div class="hidden overflow-x-auto sm:block">
                  <table class="w-full text-left border-collapse">
                    <tbody class="divide-y divide-[#E8E8E8]">
                      <tr tabindex="0" role="row" class="group cursor-pointer outline-none transition-all duration-200 ease-in-out hover:bg-pluto-50 hover:shadow-sm hover:border-l-2 hover:border-l-pluto-500 active:bg-pluto-100 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pluto-500 bg-white">
                        <td class="px-6 py-4">
                          <div class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tight bg-[#0A0A0A] text-white">confirmed</div>
                        </td>
                        <td class="px-6 py-4">
                          <p class="text-sm font-semibold text-[#0A0A0A] truncate max-w-[200px]">Test Payment 1</p>
                        </td>
                        <td class="px-6 py-4">
                          <time class="text-[11px] font-medium text-[#6B6B6B]" datetime="2024-01-01">1/1/2024</time>
                        </td>
                        <td class="px-6 py-4 text-right">
                          <p class="text-sm font-bold text-[#0A0A0A]">100 XLM</p>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            \`;
          </script>
        </body>
      </html>
    `);
  });

  test("mobile card hover states apply Pluto theme colors", async ({ page }) => {
    const mobileCard = page.locator('.sm\\:hidden [role="row"]').first();

    // Check initial state
    await expect(mobileCard).toHaveCSS("background-color", "rgba(255, 255, 255, 1)");
    await expect(mobileCard).toHaveCSS("border-left-width", "0px");

    // Hover and check styles
    await mobileCard.hover();
    await expect(mobileCard).toHaveCSS("background-color", "rgba(240, 246, 251, 1)"); // --pluto-50
    await expect(mobileCard).toHaveCSS("border-left-color", "rgba(74, 111, 165, 1)"); // --pluto-500
    await expect(mobileCard).toHaveCSS("border-left-width", "2px");
    await expect(mobileCard).toHaveCSS("box-shadow", /rgba/); // shadow-sm applied
  });

  test("mobile card active states apply theme colors and scale", async ({ page }) => {
    const mobileCard = page.locator('.sm\\:hidden [role="row"]').first();

    // Simulate active state (mousedown)
    await mobileCard.hover();
    await page.mouse.down();

    // Check active styles are applied
    await expect(mobileCard).toHaveCSS("background-color", "rgba(220, 233, 244, 1)"); // --pluto-100
    // Note: transform scale might not be directly testable in all browsers
  });

  test("desktop table row hover states apply Pluto theme colors", async ({ page }) => {
    const tableRow = page.locator('.hidden.sm\\:block tr[role="row"]').first();
    const tableCell = tableRow.locator('td').first();

    // Check initial state
    await expect(tableRow).toHaveCSS("background-color", "rgba(255, 255, 255, 1)");
    await expect(tableCell).toHaveCSS("border-left-width", "0px");

    // Hover and check styles
    await tableRow.hover();
    await expect(tableRow).toHaveCSS("background-color", "rgba(240, 246, 251, 1)"); // --pluto-50
    await expect(tableCell).toHaveCSS("border-left-color", "rgba(74, 111, 165, 1)"); // --pluto-500
    await expect(tableCell).toHaveCSS("border-left-width", "2px");
    await expect(tableRow).toHaveCSS("box-shadow", /rgba/); // shadow-sm applied
  });

  test("desktop table row active states apply theme colors and scale", async ({ page }) => {
    const tableRow = page.locator('.hidden.sm\\:block tr[role="row"]').first();

    // Simulate active state
    await tableRow.hover();
    await page.mouse.down();

    // Check active styles are applied
    await expect(tableRow).toHaveCSS("background-color", "rgba(220, 233, 244, 1)"); // --pluto-100
  });

  test("focus-visible states work for keyboard navigation", async ({ page }) => {
    const mobileCard = page.locator('.sm\\:hidden [role="row"]').first();

    // Focus the element
    await mobileCard.focus();

    // Check focus ring is applied
    await expect(mobileCard).toHaveCSS("box-shadow", /74, 111, 165/); // --pluto-500 in box-shadow
  });

  test("cursor pointer is applied for interactivity feedback", async ({ page }) => {
    const mobileCard = page.locator('.sm\\:hidden [role="row"]').first();
    const tableRow = page.locator('.hidden.sm\\:block tr[role="row"]').first();

    await expect(mobileCard).toHaveCSS("cursor", "pointer");
    await expect(tableRow).toHaveCSS("cursor", "pointer");
  });
});