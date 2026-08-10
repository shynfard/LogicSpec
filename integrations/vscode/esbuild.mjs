#!/usr/bin/env node
/**
 * Bundles the extension to CJS and copies the Mermaid browser bundle into
 * media/ for the preview webview. The LogicSpec core is bundled straight
 * from ../../src so no root build is required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const mermaidCandidates = [
  "node_modules/mermaid/dist/mermaid.min.js",
  "node_modules/mermaid/dist/mermaid.js",
];
const mermaidSource = mermaidCandidates
  .map((candidate) => path.join(root, candidate))
  .find((candidate) => fs.existsSync(candidate));
if (mermaidSource === undefined) {
  console.error("mermaid browser bundle not found — run npm install first.");
  process.exit(1);
}
fs.mkdirSync(path.join(root, "media"), { recursive: true });
fs.copyFileSync(mermaidSource, path.join(root, "media", "mermaid.min.js"));

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [path.join(root, "src", "extension.ts")],
  bundle: true,
  outfile: path.join(root, "dist", "extension.cjs"),
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
  alias: {
    logicspec: path.join(root, "..", "..", "src", "index.ts"),
  },
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
