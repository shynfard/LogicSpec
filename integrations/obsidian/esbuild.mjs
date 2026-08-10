#!/usr/bin/env node
/**
 * Bundles the plugin to CJS (Obsidian's plugin format) and assembles dist/
 * as a drop-in plugin folder: main.js + manifest.json + styles.css.
 * The LogicSpec core is bundled straight from ../../src so no root build is
 * required. Mermaid is NOT bundled — Obsidian ships its own instance,
 * obtained at runtime via loadMermaid().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: [path.join(root, "src", "main.ts")],
  bundle: true,
  outfile: path.join(root, "dist", "main.js"),
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian"],
  sourcemap: false,
  logLevel: "info",
  alias: {
    "logicspec/core": path.join(root, "..", "..", "src", "core.ts"),
  },
};

function copyAssets() {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  for (const asset of ["manifest.json", "styles.css"]) {
    fs.copyFileSync(path.join(root, asset), path.join(root, "dist", asset));
  }
}

if (watch) {
  const context = await esbuild.context(options);
  copyAssets();
  await context.watch();
} else {
  await esbuild.build(options);
  copyAssets();
}
