#!/usr/bin/env node
/**
 * Bundles the extension to CJS and copies the Mermaid browser bundle into
 * media/ for the preview webview. The LogicSpec core is bundled straight
 * from ../../src so no root build is required — EXCEPT for the dashboard
 * client (see the copy step below), which does require a root build: the
 * built SPA isn't source the extension can bundle itself, it's Vite output.
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

/**
 * The dashboard server (`createDashboardServer`) always needs an explicit
 * `publicDir` when running inside this bundled extension — see
 * src/server/create-server.ts for why relative-path introspection can't
 * recover the built SPA's location once esbuild flattens everything into
 * one CJS module. That means the built SPA has to physically live inside
 * this package. Copy the root package's Vite build output in as media/dashboard/
 * so dashboard.ts can point publicDir at it via extensionUri.
 */
const dashboardSource = path.join(root, "..", "..", "dist", "server", "public");
if (!fs.existsSync(dashboardSource)) {
  console.error(
    `dashboard client bundle not found at ${dashboardSource} — run 'npm run build' at the repo root first.`,
  );
  process.exit(1);
}
const dashboardDest = path.join(root, "media", "dashboard");
fs.rmSync(dashboardDest, { recursive: true, force: true });
fs.cpSync(dashboardSource, dashboardDest, { recursive: true });

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

/**
 * Interactive canvas webview: React Flow + dagre bundled as a single IIFE
 * with its stylesheet emitted next to it (media/canvas.js + media/canvas.css).
 */
/** @type {import("esbuild").BuildOptions} */
const canvasOptions = {
  entryPoints: [path.join(root, "src", "webview", "canvas.tsx")],
  bundle: true,
  outfile: path.join(root, "media", "canvas.js"),
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: false,
  minify: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
};

if (watch) {
  const context = await esbuild.context(options);
  const canvasContext = await esbuild.context(canvasOptions);
  await Promise.all([context.watch(), canvasContext.watch()]);
} else {
  await esbuild.build(options);
  await esbuild.build(canvasOptions);
}
