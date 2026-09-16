import { defineConfig, devices } from "@playwright/test";

/**
 * Every kind of visitor: three browser engines on a desktop with a keyboard,
 * and phones and a tablet on touch.
 *
 * By default the tests run against `npm run preview`. Set SITE_URL to test a
 * deployed site instead, e.g. SITE_URL=https://hammadshakeelai.github.io/archbtw/
 * — which also exercises GitHub Pages' own latency and headers.
 */

const live = process.env.SITE_URL;
const base = process.env.BASE_PATH ?? "/archbtw/";
const baseURL = live ?? `http://127.0.0.1:4321${base}`;

export default defineConfig({
  testDir: "e2e",
  // Resuming downloads a ~40 MB snapshot, and the first run of a toy fetches
  // its files over 9p. Both are slow on a CI runner talking to Pages.
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 },
  // Each test runs its own emulator with 512 MB of guest memory; more than
  // two at once starves a CI runner.
  workers: process.env.CI ? 1 : 2,
  retries: live ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    { name: "ipad", use: { ...devices["iPad Pro 11"] } },
  ],
  webServer: live
    ? undefined
    : {
        command: "npm run preview",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
