/**
 * Captures desktop + mobile screenshots of the multi-wallet panel gallery for PR #1853.
 * Uses the system Chrome channel so Playwright need not download Chromium.
 *
 * Serve docs first:
 *   python -m http.server 8765 --directory docs/wallet-selector-1853
 * Then:
 *   node frontend/scripts/capture-wallet-selector-screenshots.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../docs/wallet-selector-1853");
const BASE = process.env.WALLET_SELECTOR_BASE_URL ?? "http://127.0.0.1:8765/preview.html";

const SHOTS = [
  ["ready", "01-desktop-ready"],
  ["unavailable", "02-desktop-unavailable-install"],
  ["connecting", "03-desktop-connecting"],
  ["error", "04-desktop-error"],
  ["qr-desktop", "05-desktop-walletconnect-qr"],
  ["qr-mobile", "06-mobile-walletconnect-qr"],
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 1600 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });

  const written = [];
  for (const [shot, name] of SHOTS) {
    const el = page.locator(`[data-shot="${shot}"]`);
    await el.scrollIntoViewIfNeeded();
    const file = path.join(OUT_DIR, `${name}.png`);
    await el.screenshot({ path: file, animations: "disabled" });
    written.push(path.basename(file));
  }

  // Full-page desktop gallery
  const fullDesktop = path.join(OUT_DIR, "00-gallery-desktop.png");
  await page.setViewportSize({ width: 1280, height: 2200 });
  await page.screenshot({ path: fullDesktop, fullPage: true, animations: "disabled" });
  written.unshift(path.basename(fullDesktop));

  // Compact viewport gallery
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: "networkidle" });
  const fullMobile = path.join(OUT_DIR, "00-gallery-mobile.png");
  await page.screenshot({ path: fullMobile, fullPage: true, animations: "disabled" });
  written.push(path.basename(fullMobile));

  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ capturedAt: new Date().toISOString(), base: BASE, shots: written }, null, 2),
  );
  await browser.close();
  console.log(`Wrote ${written.length} screenshots to ${OUT_DIR}`);
  for (const s of written) console.log(` - ${s}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
