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
import { featureWith } from "../helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Structural (file-local) diagnostic codes for a source string. */
function structuralCodes(source: string): string[] {
  return parseFeature(source).diagnostics.map((d) => d.code);
}

/** Full-pipeline diagnostic codes (structural + semantic) for a source string. */
function allCodes(source: string): string[] {
  return validateFeature(source).diagnostics.map((d) => d.code);
}

/** A valid single-decision-table feature: `assess` branches to two finals. */
function tableFeature(table: string): string {
  return featureWith(`
  start-step:
    type: decision
    label: Assess
${table}
  approve:
    type: final
    outcome: success
  reject:
    type: final
    outcome: failure
`);
}

describe("decision tables (LS307)", () => {
  it("accepts a valid decision table with a next column (backward compatible)", () => {
    const source = tableFeature(`
    decisionTable:
      hitPolicy: unique
      inputs: [age]
      outputs: [tier, next]
      rules:
        - when: ["< 18"]
          then: ["minor", "reject"]
        - when: [">= 18"]
          then: ["adult", "approve"]
`);
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("defaults the hit policy to unique when omitted", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules:
        - when: ["-"]
          then: ["approve"]
`);
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("must parse");
    const feature = normalizeFeature(parsed.data);
    const graph = buildGraph(feature);
    const node = graph.nodes.find((n) => n.id === "start-step");
    expect(node?.decisionTable?.hitPolicy).toBe("unique");
    expect(node?.decisionTable?.ruleCount).toBe(1);
  });

  it("is no longer an empty decision when only a table is present (not LS303)", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules:
        - when: ["-"]
          then: ["approve"]
`);
    expect(structuralCodes(source)).not.toContain("LS303");
  });

  it("rejects a table combined with free-form cases (mutual exclusivity)", () => {
    const source = tableFeature(`
    cases:
      - when: something
        next: approve
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules:
        - when: ["-"]
          then: ["reject"]
`);
    expect(structuralCodes(source)).toContain("LS307");
  });

  it("rejects a rule whose when-width does not match the inputs", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age, country]
      outputs: [next]
      rules:
        - when: [">= 18"]
          then: ["approve"]
`);
    const codes = structuralCodes(source);
    expect(codes).toContain("LS307");
    expect(
      parseFeature(source).diagnostics.some(
        (d) => d.code === "LS307" && d.message.includes("input column"),
      ),
    ).toBe(true);
  });

  it("rejects a rule whose then-width does not match the outputs", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [tier, next]
      rules:
        - when: [">= 18"]
          then: ["approve"]
`);
    const codes = structuralCodes(source);
    expect(codes).toContain("LS307");
    expect(
      parseFeature(source).diagnostics.some(
        (d) => d.code === "LS307" && d.message.includes("output column"),
      ),
    ).toBe(true);
  });

  it("rejects a table with no rules", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules: []
`);
    expect(structuralCodes(source)).toContain("LS307");
  });

  it("rejects a table with no output columns", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: []
      rules:
        - when: ["-"]
          then: []
`);
    expect(structuralCodes(source)).toContain("LS307");
  });

  it("resolves next-column targets through the normal target machinery (LS101)", () => {
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules:
        - when: ["< 18"]
          then: ["nowhere"]
        - when: [">= 18"]
          then: ["approve"]
`);
    // "nowhere" is not a step: the standard unknown-target check fires.
    const diagnostics = validateFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS101")).toBe(true);
    expect(diagnostics.some((d) => d.code === "LS101" && d.message.includes("nowhere"))).toBe(true);
  });

  it("treats a table target as a real edge for reachability (no false LS200)", () => {
    // `reject` is reachable ONLY through the table's next column.
    const source = tableFeature(`
    decisionTable:
      inputs: [age]
      outputs: [next]
      rules:
        - when: ["< 18"]
          then: ["reject"]
        - when: [">= 18"]
          then: ["approve"]
`);
    expect(allCodes(source)).not.toContain("LS200");
  });
});

describe("decision-table example (examples/pricing)", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "examples/pricing/eligibility.feature.yaml"),
    "utf8",
  );

  it("validates with no diagnostics at all", () => {
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("renders the table marker and its branches (golden)", () => {
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("eligibility example must parse");
    const feature = normalizeFeature(parsed.data);
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });

    // The node keeps the decision diamond but declares itself a table.
    expect(output).toContain("DECISION TABLE · FIRST · 3 rules");
    // Each rule becomes a typed branch to its target, labelled by its outputs.
    expect(output).toContain('assess -- "tier: ineligible" --> reject');
    expect(output).toContain('assess -- "tier: prime" --> approve');
    expect(output).toContain('assess -- "tier: standard" --> review');

    expect(output).toMatchSnapshot();
  });
});
