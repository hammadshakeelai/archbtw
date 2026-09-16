import { devices, expect, test, type Page } from "@playwright/test";
import { PROMPT } from "../src/lib/guest.ts";

/**
 * These boot the real guest and assert on what the guest prints, read from
 * VGA text memory. A page that merely renders would pass a DOM check with a
 * broken image, so every test waits for output only a working Linux produces.
 *
 * Commands print markers built by the shell (`btw$((6*7))` -> `btw42`) so a
 * match can't come from text already on screen, such as the MOTD.
 */

async function screen(page: Page): Promise<string> {
  return (await page.evaluate(() => window.archbtw.screenText())).join("\n");
}

async function waitForPrompt(page: Page): Promise<void> {
  await expect.poll(() => screen(page), { timeout: 120_000, intervals: [1_000] }).toContain(PROMPT);
}

test("resumes at a root shell with the MOTD", async ({ page }) => {
  await page.goto("./");
  await waitForPrompt(page);
  await expect(page.locator("#state")).toHaveText("Running");
  expect(await screen(page)).toContain("Things to try");
});

test("runs real commands typed on a keyboard", async ({ page }) => {
  await page.goto("./");
  await waitForPrompt(page);
  await page.locator("#stage").click();

  await page.keyboard.type("echo btw$((6*7))\n", { delay: 40 });
  await expect.poll(() => screen(page), { timeout: 60_000 }).toContain("btw42");

  // cowsay is a Perl script: this reads perl and the cow file over 9p.
  await page.keyboard.type("cowsay moo\n", { delay: 40 });
  await expect.poll(() => screen(page), { timeout: 180_000, intervals: [2_000] }).toContain("< moo >");

  await page.keyboard.type("echo pkgs=$(pacman -Q | wc -l)\n", { delay: 40 });
  await expect.poll(() => screen(page), { timeout: 120_000, intervals: [2_000] }).toMatch(/pkgs=2\d\d/);
});

test("shows which files the guest reads", async ({ page }) => {
  await page.goto("./");
  await waitForPrompt(page);
  await page.locator("#stage").click();
  await page.keyboard.type("figlet hi\n", { delay: 40 });
  await expect(page.locator("#reading")).toContainText("reading", { timeout: 120_000 });
});

test.describe("on a phone", () => {
  // defaultBrowserType can't be set inside a describe block.
  const { defaultBrowserType: _, ...pixel } = devices["Pixel 7"];
  test.use(pixel);

  test("the key bar sends keys a phone keyboard lacks", async ({ page }) => {
    await page.goto("./");
    await waitForPrompt(page);

    await expect(page.getByRole("toolbar")).toBeVisible();
    await page.locator("#stage").tap();
    const keyboard = page.locator("#phone-keyboard");

    // Tab completes "ech" to "echo " in the guest's bash.
    await keyboard.pressSequentially("ech", { delay: 60 });
    await page.getByRole("button", { name: "Tab", exact: true }).tap();
    await keyboard.pressSequentially("tab$((40+2))", { delay: 60 });
    await keyboard.press("Enter");
    await expect.poll(() => screen(page), { timeout: 60_000 }).toContain("tab42");
  });
});
