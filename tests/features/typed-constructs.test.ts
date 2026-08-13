import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  normalizeFeature,
  parseFeature,
  renderMermaid,
  validateFeature,
} from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "examples/reminders/renewal.feature.yaml"), "utf8");

describe("v0.6.0 vocabulary example (examples/reminders)", () => {
  it("validates with no diagnostics at all", () => {
    const result = validateFeature(SOURCE);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("renders typed events, guards and a terminated final (golden)", () => {
    const parsed = parseFeature(SOURCE);
    if (!parsed.data) throw new Error("renewal example must parse");
    const feature = normalizeFeature(parsed.data);
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });

    // Typed events surface their kind in the node marker.
    expect(output).toContain("EVENT · TIMER");
    expect(output).toContain("EVENT · MESSAGE");
    expect(output).toContain("EVENT · SIGNAL");
    // A terminated final is distinguished from a normal one.
    expect(output).toContain("FINAL · failure · ⦻ TERMINATE");
    // Guards render as a bracketed suffix on the edge label.
    expect(output).toContain("[when: gateway confirms the charge]");
    expect(output).toContain("[when: customer supplies a new card]");

    expect(output).toMatchSnapshot();
  });
});
