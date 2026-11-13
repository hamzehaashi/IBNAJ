import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use a preinstalled Chromium when the machine provides one (cloud dev containers); CI installs its own.
const PREINSTALLED_CHROMIUM = "/opt/pw-browsers/chromium";
const launchOptions = existsSync(PREINSTALLED_CHROMIUM) ? { executablePath: PREINSTALLED_CHROMIUM } : {};

const PORT = Number(process.env.E2E_PORT ?? 3100);
const MOCK_SEC_PORT = Number(process.env.MOCK_SEC_PORT ?? 3199);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 }, launchOptions },
  webServer: [
    {
      // Local stand-in for SEC EDGAR serving the test fixtures; the app uses its real SEC code path.
      command: `node tests/e2e/mock-sec-server.mjs`,
      url: `http://localhost:${MOCK_SEC_PORT}/files/company_tickers.json`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_SEC_PORT: String(MOCK_SEC_PORT) },
    },
    {
      command: `npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        SEC_USER_AGENT: "Caldun E2E tests e2e@example.com",
        SEC_BASE_URL_OVERRIDE: `http://localhost:${MOCK_SEC_PORT}`,
        CALDUN_DISABLE_TREASURY: "1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
