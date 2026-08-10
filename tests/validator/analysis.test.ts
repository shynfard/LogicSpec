import { describe, expect, it } from "vitest";
import { validateFeature } from "../../src/index.js";
import { featureWith } from "../helpers.js";

function byCode(source: string, code: string, options = {}) {
  return validateFeature(source, options).diagnostics.filter((d) => d.code === code);
}

describe("data-flow analysis (LS203)", () => {
  it("stays silent when every requirement is produced on all paths", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      go:
        produces: [itemId]
        next: use-it
  use-it:
    type: operation
    requires: [itemId]
    next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  itemId:
    type: string
`,
    );
    expect(byCode(source, "LS203")).toEqual([]);
  });

  it("reports a requirement that no path produces", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      go: { next: use-it }
  use-it:
    type: operation
    requires: [itemId]
    next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  itemId:
    type: string
`,
    );
    const findings = byCode(source, "LS203");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toContain('"itemId"');
    expect(findings[0]?.message).toContain('"use-it"');
  });

  it("reports a requirement missing on ONE of several paths", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      fill:
        produces: [itemId]
        next: use-it
      skip:
        next: use-it
  use-it:
    type: operation
    requires: [itemId]
    next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  itemId:
    type: string
`,
    );
    const findings = byCode(source, "LS203");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('arriving from "start-step"');
  });

  it("handles retry loops without false positives", () => {
    // reserve produces reservationId; the conflict loop back through the page
    // re-enters reserve, where the requirement on checkout is still met on
    // the only path that reaches it (success).
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      pick:
        produces: [slot]
        next: reserve
  reserve:
    type: operation
    requires: [slot]
    produces: [reservationId]
    on:
      success: { next: checkout }
      conflict: { next: start-step }
  checkout:
    type: page
    requires: [reservationId]
    actions:
      pay: { next: fin }
  fin:
    type: final
    outcome: success
`,
      `context:
  slot:
    type: string
  reservationId:
    type: string
`,
    );
    expect(byCode(source, "LS203")).toEqual([]);
  });

  it("checks action-level requires", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      buy:
        requires: [itemId]
        next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  itemId:
    type: string
`,
    );
    const findings = byCode(source, "LS203");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('action "buy"');
  });

  it("never reports for unreachable steps", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      go: { next: fin }
  island:
    type: operation
    requires: [itemId]
    next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  itemId:
    type: string
`,
    );
    // island is unreachable (LS200) and unusable for dataflow conclusions.
    expect(byCode(source, "LS203")).toEqual([]);
  });
});

describe("unused declarations (LS401/LS402)", () => {
  it("flags context variables never required or produced", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`,
      `context:
  ghost:
    type: string
`,
    );
    const findings = byCode(source, "LS401");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.path).toEqual(["context", "ghost"]);
  });

  it("flags actors never assigned to a step", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actor: web
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`,
      `actors:
  web:
    kind: frontend
  phantom:
    kind: service
`,
    );
    const findings = byCode(source, "LS402");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"phantom"');
  });
});

describe("subflow outcome contracts (LS404)", () => {
  const source = featureWith(`
  start-step:
    type: subflow
    flow: payment
    on:
      success: { next: fin }
      cancelld: { next: fin }
  fin:
    type: final
    outcome: success
`);

  it("flags outcomes the target feature never ends in", () => {
    const flowOutcomes = new Map([["payment", new Set(["success", "cancelled"])]]);
    const findings = byCode(source, "LS404", {
      knownFlows: new Set(["payment"]),
      flowOutcomes,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.suggestion).toBe("cancelled");
  });

  it("stays silent without workspace flow information", () => {
    expect(byCode(source, "LS404")).toEqual([]);
  });
});

describe("severity overrides", () => {
  const source = featureWith(`
  start-step:
    type: page
    actions:
      go: { next: fin }
  island:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`);

  it("promotes a warning to an error and flips validity", () => {
    const plain = validateFeature(source);
    expect(plain.valid).toBe(true);

    const strict = validateFeature(source, { severityOverrides: { LS200: "error" } });
    expect(strict.valid).toBe(false);
    expect(strict.diagnostics.find((d) => d.code === "LS200")?.severity).toBe("error");
  });

  it('drops diagnostics mapped to "off"', () => {
    const result = validateFeature(source, { severityOverrides: { LS200: "off", LS400: "off" } });
    expect(result.diagnostics.filter((d) => d.code === "LS200")).toEqual([]);
    expect(result.diagnostics.filter((d) => d.code === "LS400")).toEqual([]);
  });
});
