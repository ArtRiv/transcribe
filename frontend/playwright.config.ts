import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 4 TEST-05 — anonymous golden path E2E.
 * Mock-engine + mock-realtime by default (NEXT_PUBLIC_USE_MOCKS=1).
 * Real-engine variant is an opt-in dev script (documented in 04-08).
 * [Cited: 04-RESEARCH.md §Validation Architecture; 04-PATTERNS.md "Tests"]
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Reuse a running dev server when invoked locally; spin one up otherwise.
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_USE_MOCKS: "1",
        },
      },
});
