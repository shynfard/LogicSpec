#!/usr/bin/env node
/**
 * Lockstep version check: every publishable package in this repo must carry
 * the same version as the root package.json. Run in CI and before release.
 * Exit 0 when aligned, 1 with a report when not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MANIFESTS = [
  "package.json",
  "integrations/vscode/package.json",
  "integrations/editor/package.json",
  "integrations/obsidian/package.json",
  "integrations/obsidian/manifest.json",
  "integrations/claude-plugin/.claude-plugin/plugin.json",
];

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const rootVersion = read("package.json").version;
let ok = true;

for (const rel of MANIFESTS) {
  const version = read(rel).version;
  if (version !== rootVersion) {
    ok = false;
    console.error(`✗ ${rel}: ${version} (root is ${rootVersion})`);
  }
}

// The Obsidian version map must have an entry for the current version, or
// the plugin cannot declare its minimum app version for this release.
const versionsMap = read("integrations/obsidian/versions.json");
if (versionsMap[rootVersion] === undefined) {
  ok = false;
  console.error(`✗ integrations/obsidian/versions.json: missing entry for ${rootVersion}`);
}

if (!ok) {
  console.error("\nVersions are locked in lockstep — bump every manifest together.");
  process.exit(1);
}
console.log(`✓ all packages at ${rootVersion}`);
