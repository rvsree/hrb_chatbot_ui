import { defineConfig, devices } from "@playwright/test";

// TEST_BASE_URL switches target: unset -> http://localhost:5173 (local dev
// server, run `npm run dev` first), or point it at the live AWS frontend
// (https://hrb-chatbot-ui.rvsree.dev) to verify a real deploy end to end -
// exactly the gap that cost real time today (reasoning about frontend
// behavior instead of actually clicking through it before claiming done).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
