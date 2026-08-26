import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/client/**/*.test.ts", "tests/client/**/*.test.tsx"],
    environment: "jsdom",
  },
});
