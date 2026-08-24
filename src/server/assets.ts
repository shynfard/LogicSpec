import { createRequire } from "node:module";
import path from "node:path";

/**
 * Locates the `mermaid` package's prebuilt browser bundle from wherever
 * this module's dependencies resolve — the CLI's own `node_modules`, where
 * `mermaid` is a real dependency of this package. VS Code passes its own
 * `mermaidAssetPath` override instead (see src/server/create-server.ts):
 * the packaged extension excludes `node_modules`, so this resolution would
 * fail there.
 */
export function defaultMermaidAssetPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("mermaid/package.json");
  return path.join(path.dirname(packageJsonPath), "dist", "mermaid.min.js");
}
