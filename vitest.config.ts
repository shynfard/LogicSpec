import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/client/**", "**/node_modules/**"],
    // Deliberate stress tests (10k-entry catalogs, 2k-step documents) are fast
    // alone but can take tens of seconds under parallel suite load; a tight
    // timeout makes them flaky. A true hang still fails — just later.
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary"],
      // Floors sit a few points under the measured baseline (88% lines,
      // 85% branches, 96% functions at the time they were set) — a real
      // regression trips them; normal churn does not. Raise them as
      // coverage grows; never lower them to make a PR pass.
      thresholds: {
        lines: 85,
        statements: 85,
        branches: 80,
        functions: 90,
      },
    },
  },
});
