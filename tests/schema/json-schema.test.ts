import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateJsonSchemas } from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("JSON Schema generation", () => {
  it("is deterministic", () => {
    const first = JSON.stringify(generateJsonSchemas());
    const second = JSON.stringify(generateJsonSchemas());
    expect(first).toBe(second);
  });

  it("matches the checked-in schemas/ files (run `npm run schemas` after schema changes)", () => {
    for (const { file, schema } of generateJsonSchemas()) {
      const checkedIn = fs.readFileSync(path.join(ROOT, "schemas", file), "utf8");
      expect(`${JSON.stringify(schema, null, 2)}\n`, file).toBe(checkedIn);
    }
  });
});
