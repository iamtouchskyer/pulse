import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
