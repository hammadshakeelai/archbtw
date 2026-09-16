/**
 * Take the README screenshots and the social preview image from the real
 * guest.
 *
 *   npm run build && npm run preview   # or set SITE_URL to use the live site
 *   npm run screenshots
 *
 * Writes docs/screenshot.png, docs/screenshot-phone.png and public/og.png.
 */

import { chromium, devices, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT } from "../src/lib/guest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE_URL ?? "http://127.0.0.1:4321/archbtw/";

async function screenText(page: Page): Promise<string> {
  return (await page.evaluate(() => window.archbtw.screenText())).join("\n");
}

async function waitFor(page: Page, text: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await screenText(page)).includes(text)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for "${text}"`);
    await page.waitForTimeout(500);
  }
}

/** Resume, clear the MOTD away and show neofetch, which is what people post. */
async function neofetch(page: Page, touch: boolean): Promise<void> {
  await page.goto(SITE);
  await waitFor(page, PROMPT);
  const command = "clear; neofetch\n";
  if (touch) {
    await page.locator("#stage").tap({ position: { x: 20, y: 20 } });
    await page.locator("#phone-keyboard").pressSequentially(command, { delay: 30 });
  } else {
    await page.keyboard.type(command, { delay: 30 });
  }
  // Memory is the last line neofetch prints before its colour blocks.
  await waitFor(page, "Memory");
  // Let the colour blocks at the end draw, and the "reading" line settle.
  await page.waitForTimeout(4_000);
}

async function shoot(browser: Browser, name: string, options: Parameters<Browser["newContext"]>[0], path: string) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await neofetch(page, Boolean(options?.hasTouch));
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path });
  console.log(`${name}: ${path}`);
  await context.close();
}

const browser = await chromium.launch();
try {
  await shoot(browser, "desktop", { viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 }, join(ROOT, "docs", "screenshot.png"));
  const { defaultBrowserType: _, ...pixel } = devices["Pixel 7"];
  await shoot(browser, "phone", pixel, join(ROOT, "docs", "screenshot-phone.png"));
  await shoot(browser, "social preview", { viewport: { width: 1200, height: 630 } }, join(ROOT, "public", "og.png"));
} finally {
  await browser.close();
}
