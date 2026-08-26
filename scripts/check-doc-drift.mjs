#!/usr/bin/env node
/**
 * Doc drift check: every diagnostic code defined in src/diagnostics/codes.ts
 * must be documented in docs/validation.md AND in the Claude plugin's
 * diagnostics reference. This is what keeps the agent-facing material from
 * silently rotting behind the language again. Exit 0 when covered, 1 with a
 * report when not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const source = fs.readFileSync(path.join(ROOT, "src/diagnostics/codes.ts"), "utf8");
const defined = [...new Set(source.match(/"LS\d{3}"/g)?.map((m) => m.slice(1, -1)) ?? [])].sort();

if (defined.length === 0) {
  console.error("✗ could not extract any LS codes from src/diagnostics/codes.ts");
  process.exit(1);
}

const DOCS = [
  "docs/validation.md",
  "integrations/claude-plugin/skills/logicspec-authoring/references/diagnostics.md",
];

let ok = true;
for (const rel of DOCS) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const missing = defined.filter((code) => !text.includes(code));
  if (missing.length > 0) {
    ok = false;
    console.error(`✗ ${rel}: missing ${missing.join(", ")}`);
  }
}

if (!ok) {
  console.error(
    `\n${defined.length} codes are defined in src/diagnostics/codes.ts; document every one in both files.`,
  );
  process.exit(1);
}
console.log(`✓ all ${defined.length} LS codes documented in ${DOCS.length} files`);
