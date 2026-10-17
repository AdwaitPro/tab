import { defineConfig } from "@playwright/test";

/** Smoke checks against a running production build: `pnpm build && pnpm start`, then `pnpm e2e`. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1512, height: 771 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
