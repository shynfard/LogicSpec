import { describe, expect, it } from "vitest";
import { parseFeature } from "../../src/index.js";
import { featureWith, MINIMAL_FEATURE } from "../helpers.js";

function codes(source: string): string[] {
  return parseFeature(source).diagnostics.map((d) => d.code);
}

describe("parseFeature", () => {
  it("parses a minimal valid feature", () => {
    const result = parseFeature(MINIMAL_FEATURE);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.data?.feature.id).toBe("demo");
    expect(Object.keys(result.data?.steps ?? {})).toEqual(["home", "done"]);
  });

  it("reports LS001 for invalid YAML with a location", () => {
    const result = parseFeature("version: [unclosed");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS001");
    expect(result.diagnostics[0]?.location?.line).toBeGreaterThan(0);
  });

  it("rejects unknown top-level properties", () => {
    const result = parseFeature(`${MINIMAL_FEATURE}\nbogus: true\n`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS002");
    expect(result.diagnostics[0]?.message).toContain('"bogus"');
  });

  it("rejects unknown step properties (typo catching)", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: page
    actionz:
      go:
        next: start-step
`),
    );
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === "LS002" && d.message.includes("actionz")),
    ).toBe(true);
  });

  it("rejects an unknown step type and suggests the nearest one", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: opration
    next: start-step
`),
    );
    expect(result.ok).toBe(false);
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("LS002");
    expect(diagnostic?.message).toContain('Unknown step type "opration"');
    expect(diagnostic?.suggestion).toBe("operation");
  });

  it("parses every step type", () => {
    const source = `
version: "1"
feature:
  id: all-types
  name: All Types
start: p
steps:
  p:
    type: page
    actions:
      go: { next: d }
  d:
    type: decision
    cases:
      - when: x > 0
        next: o
    default: { next: e }
  o:
    type: operation
    call: svc.op
    next: ev
  ev:
    type: event
    direction: publish
    event: ThingHappened
    next: w
  w:
    type: wait
    duration: 10m
    next: sf
  sf:
    type: subflow
    flow: other
    next: par
  par:
    type: parallel
    branches:
      a: { flow: other }
    wait: all
    next: e
  e:
    type: error
    actions:
      retry: { next: p }
      give-up: { next: f }
  f:
    type: final
    outcome: failure
`;
    const result = parseFeature(source);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an operation with both next and on (LS301)", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: operation
    next: fin
    on:
      success: { next: fin }
  fin:
    type: final
    outcome: success
`),
    );
    expect(result.ok).toBe(false);
    expect(
      codes(
        featureWith(`
  start-step:
    type: operation
    next: fin
    on:
      success: { next: fin }
  fin:
    type: final
    outcome: success
`),
      ),
    ).toContain("LS301");
  });

  it("rejects a final step with a transition (LS300)", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: final
    outcome: success
    next: start-step
`),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS300");
  });

  it("enforces event direction rules (LS302)", () => {
    const publishWithOn = featureWith(`
  start-step:
    type: event
    direction: publish
    event: Thing
    next: fin
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(publishWithOn)).toContain("LS302");

    const waitWithoutOn = featureWith(`
  start-step:
    type: event
    direction: wait
    event: Thing
  fin:
    type: final
    outcome: success
`);
    expect(codes(waitWithoutOn)).toContain("LS302");
  });

  it("rejects an empty decision (LS303) and empty parallel (LS304)", () => {
    expect(
      codes(
        featureWith(`
  start-step:
    type: decision
`),
      ),
    ).toContain("LS303");
    expect(
      codes(
        featureWith(`
  start-step:
    type: parallel
    branches: {}
    next: fin
  fin:
    type: final
    outcome: success
`),
      ),
    ).toContain("LS304");
  });

  it("rejects a malformed duration", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: wait
    duration: soon
    next: start-step
`),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS002");
  });

  it("accepts namespaced extensions and rejects non-namespaced keys", () => {
    const good = parseFeature(
      `${MINIMAL_FEATURE}\nextensions:\n  company.example/foo:\n    a: 1\n`,
    );
    expect(good.ok).toBe(true);

    const bad = parseFeature(`${MINIMAL_FEATURE}\nextensions:\n  notNamespaced: true\n`);
    expect(bad.ok).toBe(false);
  });

  it("rejects a wrong version", () => {
    const result = parseFeature(MINIMAL_FEATURE.replace('version: "1"', 'version: "2"'));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS002");
    expect(result.diagnostics[0]?.path).toEqual(["version"]);
  });
});
