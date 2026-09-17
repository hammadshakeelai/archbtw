import { expect, test } from "@playwright/test";
import { PROMPT } from "../src/lib/guest.ts";
import {
  guardPage,
  guestScreen,
  isTouch,
  occurrences,
  paintedScreen,
  resume,
  typeKeys,
  waitForLine,
  waitForText,
} from "./helpers.ts";

/**
 * Every test here boots the real guest and asserts on what it prints. A page
 * that merely renders would pass a DOM check with a broken image.
 *
 * Commands print markers the shell builds (`\x62tw\x34\x32` -> `btw42`), so a
 * match can't come from text already on screen, such as the MOTD or the
 * command line itself.
 *
 * The projects in playwright.config.ts cover Chromium, Firefox and WebKit on a
 * desktop, and Android, iPhone and iPad on touch.
 */

test.describe("with a hardware keyboard", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(isTouch(testInfo), "touch devices have their own journey");
  });

  test("resume, run toys, leave the terminal, restart", async ({ page, baseURL }) => {
    const guard = await guardPage(page, baseURL!);

    await test.step("resumes at a root shell with the MOTD painted", async () => {
      await resume(page);
      // Focus starts in the terminal, so typing works without a click.
      await expect(page.locator("#stage")).toBeFocused();
    });

    await test.step("runs a command", async () => {
      await typeKeys(page, "echo -e \\\\x62tw\\\\x34\\\\x32\n");
      await waitForLine(page, "btw42", 60_000);
    });

    await test.step("keeps the visitor's clock, not the one the snapshot was built with", async () => {
      await typeKeys(page, "date --iso-8601=seconds\n");
      await expect
        .poll(
          async () => {
            const stamp = (await guestScreen(page))
              .split("\n")
              .map((row) => row.trim())
              .findLast((row) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(row));
            return stamp ? Math.abs(Date.parse(stamp) - Date.now()) / 1000 : Number.POSITIVE_INFINITY;
          },
          { timeout: 60_000, intervals: [1_000], message: "seconds between the guest's clock and the real one" },
        )
        .toBeLessThan(600);
    });

    await test.step("runs a Perl toy, fetching its files over 9p", async () => {
      await typeKeys(page, "cowsay moo\n");
      await waitForText(page, "< moo >", 240_000);
      await expect(page.locator("#reading")).toContainText("reading");
    });

    await test.step("reads pacman's database offline", async () => {
      await typeKeys(page, "pacman --query --info sl\n");
      await waitForText(page, "Installed Size");
    });

    await test.step("Ctrl+] moves focus to the page controls, and keys stay out of the guest", async () => {
      await page.keyboard.press("Control+BracketRight");
      const controls = page.locator("#fullscreen:visible, #restart:visible").first();
      await expect(controls).toBeFocused();
      await page.keyboard.type("zzqq");
      await page.waitForTimeout(2_000);
      expect(await guestScreen(page)).not.toContain("zzqq");
    });

    await test.step("clicking the terminal gives it the keyboard back", async () => {
      await page.locator("#stage").click({ position: { x: 20, y: 20 } });
      await typeKeys(page, "echo -e \\\\x62ack\n");
      await waitForLine(page, "back", 60_000);
    });

    await test.step("Restart brings up a fresh machine", async () => {
      await typeKeys(page, "touch /root/restartcheck; ls /root\n");
      await expect.poll(() => occurrences(page, "restartcheck"), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);

      await page.locator("#restart").click();
      await waitForText(page, PROMPT, 180_000);
      await expect(page.locator("#stage")).toBeFocused();
      await typeKeys(page, "ls -a /root\n");
      await waitForText(page, ".bash_profile");
      expect(await guestScreen(page)).not.toContain("restartcheck");
    });

    await test.step("stayed inside its security policy and its own origin", async () => {
      await guard.assertClean();
    });
  });
});

test.describe("on a touch screen", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!isTouch(testInfo), "needs a touch device");
  });

  test("key bar, phone keyboard symbols and Ctrl", async ({ page, baseURL }) => {
    const guard = await guardPage(page, baseURL!);

    await test.step("resumes at a root shell with the MOTD painted", async () => {
      await resume(page);
      await expect(page.getByRole("toolbar")).toBeVisible();
    });

    const keyboard = page.locator("#phone-keyboard");

    await test.step("tapping the terminal focuses the phone keyboard", async () => {
      await page.locator("#stage").tap({ position: { x: 20, y: 20 } });
      await expect(keyboard).toBeFocused();
    });

    await test.step("Tab from the key bar completes, and shifted symbols arrive intact", async () => {
      await keyboard.pressSequentially("ech", { delay: 60 });
      await page.getByRole("button", { name: "Tab", exact: true }).tap();
      await keyboard.pressSequentially("tab$((40+2))", { delay: 60 });
      await keyboard.press("Enter");
      await waitForLine(page, "tab42", 60_000);
    });

    // Each interrupt starts from a cleared screen, so earlier output scrolling
    // away can't change what's counted.
    const sleepOnCleanScreen = async () => {
      await keyboard.pressSequentially("clear", { delay: 40 });
      await keyboard.press("Enter");
      await expect.poll(() => occurrences(page, "^C"), { timeout: 60_000 }).toBe(0);
      await keyboard.pressSequentially("sleep 600", { delay: 40 });
      await keyboard.press("Enter");
      await page.waitForTimeout(1_000);
    };

    await test.step("the Ctrl+C key stops a running command", async () => {
      await sleepOnCleanScreen();
      await page.getByRole("button", { name: "Ctrl+C" }).tap();
      await expect.poll(() => occurrences(page, "^C"), { timeout: 60_000 }).toBe(1);
    });

    await test.step("sticky Ctrl plus a typed letter stops one too", async () => {
      await sleepOnCleanScreen();
      const ctrl = page.getByRole("button", { name: "Ctrl", exact: true });
      await ctrl.tap();
      await expect(ctrl).toHaveAttribute("aria-pressed", "true");
      await keyboard.pressSequentially("c");
      await expect.poll(() => occurrences(page, "^C"), { timeout: 60_000 }).toBe(1);
      await expect(ctrl).toHaveAttribute("aria-pressed", "false");

      await keyboard.pressSequentially("echo ok$((1+1))", { delay: 40 });
      await keyboard.press("Enter");
      await waitForLine(page, "ok2", 60_000);
    });

    await test.step("stayed inside its security policy and its own origin", async () => {
      await guard.assertClean();
    });
  });
});

test.describe("layout", () => {
  test("never scrolls the page sideways, and the controls fit", async ({ page }, testInfo) => {
    const widths = testInfo.project.name === "android" ? [320, 412] : [page.viewportSize()?.width ?? 1280];
    for (const width of widths) {
      await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 800 });
      await page.goto("./");
      await expect(page.locator("#state")).toHaveText(/Downloading|Running/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
      const restart = await page.locator("#restart").boundingBox();
      expect(restart, "Restart button is laid out").not.toBeNull();
      expect(restart!.x + restart!.width, `Restart fits at ${width}px`).toBeLessThanOrEqual(width + 0.5);
    }
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("./");
    const animation = await page.locator("#boot-cursor").evaluate((cursor) => getComputedStyle(cursor).animationName);
    expect(animation).toBe("none");
  });
});

test.describe("when something goes wrong", () => {
  test("explains a browser without WebAssembly", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error -- simulating a browser that lacks WebAssembly
      delete globalThis.WebAssembly;
    });
    await page.goto("./");
    await expect(page.getByRole("alert")).toContainText("doesn't support WebAssembly");
    await expect(page.locator("#retry")).toBeHidden();
    await expect(page.locator("#restart")).toBeHidden();
  });

  test("offers to try again when the machine can't download, and trying again works", async ({ page }, testInfo) => {
    await page.route("**/arch_state.bin.zst", (route) => route.fulfill({ status: 503, body: "unavailable" }));
    await page.goto("./");
    await expect(page.getByRole("alert")).toContainText("didn't finish downloading");

    await page.unroute("**/arch_state.bin.zst");
    const retry = page.getByRole("button", { name: "Try again" });
    if (isTouch(testInfo)) await retry.tap();
    else await retry.click();
    await waitForText(page, PROMPT, 180_000);
    await expect(paintedScreen(page)).toContainText("Things to try");
  });
});
