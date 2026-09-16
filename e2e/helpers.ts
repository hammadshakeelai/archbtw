import { expect, type Page, type TestInfo } from "@playwright/test";
import { PROMPT } from "../src/lib/guest.ts";

/**
 * What the guest has on its screen, from v86's screen events. Tests assert on
 * this rather than the DOM when they need what the machine printed.
 */
export async function guestScreen(page: Page): Promise<string> {
  return (await page.evaluate(() => window.archbtw.screenText())).join("\n");
}

/** What the visitor actually sees painted on the page. */
export function paintedScreen(page: Page) {
  return page.locator(".v86-text");
}

export async function waitForText(page: Page, text: string | RegExp, timeout = 120_000): Promise<void> {
  const poll = expect.poll(() => guestScreen(page), { timeout, intervals: [1_000] });
  if (typeof text === "string") await poll.toContain(text);
  else await poll.toMatch(text);
}

/** Load the page and wait until the resumed guest shows its prompt, painted. */
export async function resume(page: Page): Promise<void> {
  await page.goto("./");
  await waitForText(page, PROMPT, 180_000);
  await expect(page.locator("#state")).toHaveText("Running");
  await expect(paintedScreen(page)).toContainText("Things to try");
}

export function isTouch(testInfo: TestInfo): boolean {
  return Boolean(testInfo.project.use.hasTouch);
}

/** How many times `text` appears on the guest's screen. */
export async function occurrences(page: Page, text: string): Promise<number> {
  return (await guestScreen(page)).split(text).length - 1;
}

/**
 * Type on a hardware keyboard. Playwright presses "$" as the 4 key without
 * holding Shift, and v86 translates keys by key code, so these tests only type
 * unshifted characters and build anything else in the shell (`\x62` -> `b`).
 */
export async function typeKeys(page: Page, text: string): Promise<void> {
  if (/[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(text)) {
    throw new Error(`typeKeys can't type shifted characters: ${text}`);
  }
  await page.keyboard.type(text, { delay: 35 });
}
