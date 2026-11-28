import { defineConfig, devices } from "@playwright/test"

// The page in a real browser, given by the real server from the built app/dist (e2e/server.ts starts it).
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  timeout: 30_000,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
