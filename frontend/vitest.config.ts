// frontend/vitest.config.ts
// Phase 1: just enough to prove Vitest runs and the @/* alias resolves.
// Phase 3 (TEST-03) will add component/render tests for the export renderers.
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
