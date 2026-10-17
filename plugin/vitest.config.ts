import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { TAB_LOG: "off" },
    testTimeout: 15_000,
  },
});
