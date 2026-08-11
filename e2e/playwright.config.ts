import { defineConfig } from "@playwright/test";

// A single serial worker on purpose: the onboarding journey is one continuous
// story (register -> import -> dashboard -> recategorize -> re-import), and
// the re-import test picks up the account and transactions the first test
// created via a shared storageState handoff (see tests/onboarding.spec.ts).
// Running it in parallel workers or shuffled order would break that chain.
export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.YIELDO_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
