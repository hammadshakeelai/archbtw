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

/**
 * Wait for a line of output that is exactly `line`. Substring matches let
 * errors pass: `-bash: echtab42: command not found` contains "tab42".
 */
export async function waitForLine(page: Page, line: string, timeout = 120_000): Promise<void> {
  await expect
    .poll(async () => (await guestScreen(page)).split("\n").some((row) => row.trim() === line), {
      timeout,
      intervals: [1_000],
      message: `a line reading exactly "${line}"`,
    })
    .toBe(true);
}

/** Load the page and wait until the resumed guest shows its prompt, painted. */
export async function resume(page: Page): Promise<void> {
  await page.goto("./");
  await waitForText(page, PROMPT, 180_000);
  await expect(page.locator("#state")).toHaveText("Running");
  await expect(paintedScreen(page)).toContainText("Things to try");
}

/**
 * Record Content-Security-Policy violations and requests to other origins, so
 * a journey can finish by proving the page stayed inside its own policy and
 * told no third party about the visit. Call before the page loads.
 */
export async function guardPage(page: Page, baseURL: string): Promise<{ assertClean: () => Promise<void> }> {
  const siteOrigin = new URL(baseURL).origin;
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && url.origin !== siteOrigin) external.push(request.url());
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
    });
  });
  return {
    assertClean: async () => {
      const violations = await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
      expect(violations, "Content-Security-Policy violations").toEqual([]);
      expect(external, "requests to other origins").toEqual([]);
    },
  };
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
