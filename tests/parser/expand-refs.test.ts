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
