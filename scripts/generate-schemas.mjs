#!/usr/bin/env node
/**
 * Regenerates schemas/*.schema.json from the canonical Zod schemas.
 * Run `npm run schemas` after changing anything under src/schema/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateJsonSchemas } from "../dist/schema/json-schema.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "schemas");
fs.mkdirSync(outDir, { recursive: true });

for (const { file, schema } of generateJsonSchemas()) {
  const outPath = path.join(outDir, file);
  fs.writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, outPath)}`);
}
