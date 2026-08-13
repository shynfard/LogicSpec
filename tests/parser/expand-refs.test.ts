import { describe, expect, it } from "vitest";
import type { DefinitionsFile } from "../../src/index.js";
import {
  buildGraph,
  normalizeFeature,
  parseDefinitions,
  parseFeature,
  renderMermaid,
  validateFeature,
} from "../../src/index.js";
import { MINIMAL_FEATURE } from "../helpers.js";

const DEFINITIONS = `
version: "1"
actors:
  notifier:
    kind: service
    label: Notification Service
steps:
  send-notification:
    type: operation
    label: Send Notification
    actor: notifier
`;

/** Parses a definitions catalog fixture, failing loudly on a bad fixture. */
function definitions(source = DEFINITIONS): DefinitionsFile {
  const parsed = parseDefinitions(source);
  if (!parsed.data) {
    throw new Error(`bad definitions fixture: ${JSON.stringify(parsed.diagnostics)}`);
  }
  return parsed.data;
}

/** A feature that references a shared actor and a shared step template. */
const REF_FEATURE = `
version: "1"
feature:
  id: demo
  name: Demo
start: home
actors:
  web:
    kind: frontend
  notifier:
    $ref: "definitions#/actors/notifier"
steps:
  home:
    type: page
    actor: web
    actions:
      go:
        next: notify
  notify:
    $ref: "definitions#/steps/send-notification"
    label: Do It
    next: done
  done:
    type: final
    outcome: success
`;

function codes(source: string, defs?: DefinitionsFile): string[] {
  return parseFeature(source, { definitions: defs }).diagnostics.map((d) => d.code);
}

/** A definitions catalog with a LINEAR chain `s0 → s1 → … → s<depth>` (concrete tail). */
function deepChainDefinitions(depth: number): string {
  const lines = ['version: "1"', "steps:"];
  for (let i = 0; i < depth; i++) {
    lines.push(`  s${i}:`, `    $ref: "definitions#/steps/s${i + 1}"`);
  }
  lines.push(`  s${depth}:`, "    type: operation", "    label: End");
  return `${lines.join("\n")}\n`;
}

/** A feature whose single $ref step points at the head of the deep chain. */
const DEEP_REF_FEATURE = `
version: "1"
feature:
  id: demo
  name: Demo
start: home
actors:
  web:
    kind: frontend
steps:
  home:
    type: page
    actor: web
    actions:
      go:
        next: deep
  deep:
    $ref: "definitions#/steps/s0"
    next: done
  done:
    type: final
    outcome: success
`;

describe("definitions schema ($ref support)", () => {
  it("accepts actor and step-template definitions", () => {
    const parsed = parseDefinitions(DEFINITIONS);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    expect(Object.keys(parsed.data?.actors ?? {})).toEqual(["notifier"]);
    expect(Object.keys(parsed.data?.steps ?? {})).toEqual(["send-notification"]);
  });

  it("accepts a definition that references another definition", () => {
    const parsed = parseDefinitions(`
version: "1"
steps:
  base:
    type: operation
    label: Base
  derived:
    $ref: "definitions#/steps/base"
    actor: notifier
`);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("rejects a non-namespaced unknown top-level key", () => {
    const parsed = parseDefinitions(`version: "1"\nbogus: true\n`);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((d) => d.code === "LS002")).toBe(true);
  });
});

describe("$ref expansion in features", () => {
  it("resolves an actor $ref to the concrete shared actor", () => {
    const result = parseFeature(REF_FEATURE, { definitions: definitions() });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.data?.actors?.notifier).toEqual({
      kind: "service",
      label: "Notification Service",
    });
    expect(result.data?.actors?.notifier).not.toHaveProperty("$ref");
  });

  it("resolves a step $ref and shallow-merges local overrides (local wins)", () => {
    const result = parseFeature(REF_FEATURE, { definitions: definitions() });
    expect(result.ok).toBe(true);
    const notify = result.data?.steps.notify;
    // type + actor come from the template; label is overridden locally; the
    // transition (next) is supplied locally; the step id is the map key.
    expect(notify).toMatchObject({
      type: "operation",
      actor: "notifier",
      label: "Do It",
      next: "done",
    });
    expect(notify).not.toHaveProperty("$ref");
  });

  it("reports LS110 for an unknown $ref target", () => {
    const source = REF_FEATURE.replace(
      "definitions#/steps/send-notification",
      "definitions#/steps/does-not-exist",
    );
    const diagnostics = parseFeature(source, { definitions: definitions() }).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS110")).toBe(true);
    // Located at the offending step; carries a nearest-name suggestion.
    const ls110 = diagnostics.find((d) => d.code === "LS110");
    expect(ls110?.path).toEqual(["steps", "notify"]);
  });

  it("reports LS110 when no definitions catalog is available", () => {
    // A feature that uses $ref but is parsed without a definitions catalog.
    expect(codes(REF_FEATURE)).toContain("LS110");
  });

  it("reports LS111 for a section mismatch (actor slot pointing at a step)", () => {
    const source = REF_FEATURE.replace(
      "definitions#/actors/notifier",
      "definitions#/steps/send-notification",
    );
    expect(codes(source, definitions())).toContain("LS111");
  });

  it("reports LS111 for a malformed $ref string", () => {
    const source = REF_FEATURE.replace(
      "definitions#/steps/send-notification",
      "http://example.com/steps/x",
    );
    expect(codes(source, definitions())).toContain("LS111");
  });

  it("reports LS112 for a definition $ref cycle", () => {
    const cyclic = definitions(`
version: "1"
steps:
  a:
    $ref: "definitions#/steps/b"
  b:
    $ref: "definitions#/steps/a"
`);
    const source = REF_FEATURE.replace(
      "definitions#/steps/send-notification",
      "definitions#/steps/a",
    );
    expect(codes(source, cyclic)).toContain("LS112");
  });

  it("surfaces normal structural diagnostics against the merged step", () => {
    // The template is an operation; a local override that adds BOTH next and on
    // must still trip the ordinary LS301 (next XOR on) on the expanded step.
    const source = REF_FEATURE.replace(
      "    label: Do It\n    next: done",
      "    label: Do It\n    next: done\n    on:\n      success:\n        next: done",
    );
    expect(codes(source, definitions())).toContain("LS301");
  });

  it("leaves a feature with no $ref byte-identical (regression)", () => {
    const withDefs = parseFeature(MINIMAL_FEATURE, { definitions: definitions() });
    const without = parseFeature(MINIMAL_FEATURE);
    expect(withDefs.ok).toBe(true);
    expect(withDefs.diagnostics).toEqual([]);
    expect(JSON.stringify(withDefs.data)).toBe(JSON.stringify(without.data));
  });

  it("expands deterministically", () => {
    const a = parseFeature(REF_FEATURE, { definitions: definitions() });
    const b = parseFeature(REF_FEATURE, { definitions: definitions() });
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });

  it("resolves an actor $ref with a local override (fix 4: local wins, still validated)", () => {
    const source = REF_FEATURE.replace(
      '    $ref: "definitions#/actors/notifier"',
      '    $ref: "definitions#/actors/notifier"\n    label: Custom Notifier',
    );
    const result = parseFeature(source, { definitions: definitions() });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    // The override key shallow-merges over the resolved actor; local wins.
    expect(result.data?.actors?.notifier).toEqual({
      kind: "service",
      label: "Custom Notifier",
    });
    expect(result.data?.actors?.notifier).not.toHaveProperty("$ref");
  });

  it("rejects an actor override key that is not a valid actor field (fix 4: still strict)", () => {
    const source = REF_FEATURE.replace(
      '    $ref: "definitions#/actors/notifier"',
      '    $ref: "definitions#/actors/notifier"\n    bogus: nope',
    );
    // The merged actor carries an unknown key → strict actor schema rejects it.
    expect(codes(source, definitions())).toContain("LS002");
  });

  it("reports LS111 for a non-string $ref in a feature slot (fix 2)", () => {
    const source = REF_FEATURE.replace('    $ref: "definitions#/actors/notifier"', "    $ref: 123");
    const diagnostics = parseFeature(source, { definitions: definitions() }).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS111")).toBe(true);
    // It must NOT fall through to a generic schema error for that slot.
    const ls111 = diagnostics.find((d) => d.code === "LS111");
    expect(ls111?.path).toEqual(["actors", "notifier"]);
  });

  it("caps a runaway-deep $ref chain with LS112 and never throws (fix 1: BLOCKER)", () => {
    // A LINEAR, non-cyclic chain thousands of links deep used to recurse into an
    // uncaught RangeError (stack overflow) that crashed validate.
    const deep = definitions(deepChainDefinitions(10_000));
    let result: ReturnType<typeof parseFeature> | undefined;
    expect(() => {
      result = parseFeature(DEEP_REF_FEATURE, { definitions: deep });
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.diagnostics.some((d) => d.code === "LS112")).toBe(true);
    // Builds + fully-walks a 10k-entry catalog (the reported crash threshold);
    // the depth cap returns fast, but parse + full-graph walk is heavy, so give
    // this deliberate stress case headroom over the 5s default under parallel load.
  }, 30000);

  it("still resolves a legitimate shallow definition-to-definition chain (fix 1)", () => {
    const chained = definitions(`
version: "1"
actors:
  notifier:
    kind: service
    label: Notification Service
steps:
  base:
    type: operation
    label: Base
  derived:
    $ref: "definitions#/steps/base"
    actor: notifier
`);
    const source = REF_FEATURE.replace(
      "definitions#/steps/send-notification",
      "definitions#/steps/derived",
    );
    const result = parseFeature(source, { definitions: chained });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.data?.steps.notify).toMatchObject({ type: "operation", actor: "notifier" });
  });

  it("validates and renders the fully-expanded graph", () => {
    const result = validateFeature(REF_FEATURE, { definitions: definitions() });
    expect(result.valid).toBe(true);
    expect(result.normalized?.actors.map((a) => a.id)).toContain("notifier");

    const normalized = normalizeFeature(result.feature ?? ({} as never));
    const mermaid = renderMermaid(normalized, buildGraph(normalized), {
      view: "flow",
      direction: "TD",
    });
    // The renderer sees the expanded step: its overridden label appears, no $ref.
    expect(mermaid).toContain("Do It");
    expect(mermaid).not.toContain("$ref");
  });
});

describe("definitions catalog load-time validation (fix wave)", () => {
  const codesOf = (source: string) =>
    parseDefinitions(source, { file: "definitions.yaml" }).diagnostics.map((d) => d.code);

  it("reports LS112 for an unreferenced definition cycle (fix 3)", () => {
    // Neither `a` nor `b` is referenced by any feature; the cycle is still
    // caught by validating the complete catalog graph at load.
    const parsed = parseDefinitions(
      `
version: "1"
steps:
  a:
    $ref: "definitions#/steps/b"
  b:
    $ref: "definitions#/steps/a"
`,
      { file: "definitions.yaml" },
    );
    const ls112 = parsed.diagnostics.find((d) => d.code === "LS112");
    expect(ls112).toBeDefined();
    expect(ls112?.file).toBe("definitions.yaml");
    expect(ls112?.path?.[0]).toBe("steps");
    // A single cycle is reported once, not once per node on it.
    expect(parsed.diagnostics.filter((d) => d.code === "LS112")).toHaveLength(1);
  });

  it("reports LS111 for a malformed $ref in an unused definition (fix 3)", () => {
    expect(
      codesOf(`
version: "1"
actors:
  orphan:
    $ref: "not-a-valid-ref"
`),
    ).toContain("LS111");
  });

  it("locates a bad step template in definitions.yaml, not the feature (fix 5)", () => {
    const parsed = parseDefinitions(
      `
version: "1"
steps:
  broken:
    type: not-a-real-type
    label: Broken
`,
      { file: "definitions.yaml" },
    );
    const schemaError = parsed.diagnostics.find((d) => d.code === "LS002");
    expect(schemaError).toBeDefined();
    expect(schemaError?.file).toBe("definitions.yaml");
    expect(schemaError?.path?.[0]).toBe("steps");
    expect(schemaError?.path?.[1]).toBe("broken");
    expect(schemaError?.message).toContain("Unknown step type");
  });

  it("accepts a step template that defers its transition to the caller (fix 5 regression)", () => {
    // A wait template omitting `next` (the caller supplies it) is valid at load.
    expect(
      codesOf(`
version: "1"
steps:
  pause:
    type: wait
    duration: 1d
`),
    ).toEqual([]);
  });
});
