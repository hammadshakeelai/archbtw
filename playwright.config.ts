import { defineConfig, devices } from "@playwright/test";

const base = process.env.BASE_PATH ?? "/archbtw/";

export default defineConfig({
  testDir: "e2e",
  // Resuming the snapshot is quick, but the first toy run under emulation
  // fetches its files over 9p and can take a while on a CI runner.
  timeout: 5 * 60_000,
  use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:4321${base}` },
  webServer: {
    command: "npm run preview",
    url: `http://localhost:4321${base}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
