import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The editor consumes the LogicSpec core straight from source so it never
// depends on the root package being built first.
const coreEntry = fileURLToPath(new URL("../../src/core.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "logicspec/core": coreEntry,
    },
  },
  server: {
    fs: {
      allow: [".", repoRoot],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
