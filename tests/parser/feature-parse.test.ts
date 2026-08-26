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

  it("reports identical diagnostic ranges for LF and CRLF sources", () => {
    // Windows-authored files must not underline the carriage return: the
    // exclusive end offset steps back over \r, so columns match LF byte-for-byte.
    const lf = featureWith(`
  start-step:
    type: operation
    call: svc.op
    next: missing-step
  fin:
    type: final
    outcome: success
`);
    const crlf = lf.replace(/\n/g, "\r\n");
    const lfResult = parseFeature(lf);
    const crlfResult = parseFeature(crlf);
    // Schema-valid in both encodings; compare the located range of the same node.
    expect(lfResult.ok).toBe(true);
    expect(crlfResult.ok).toBe(true);
    const lfLoc = lfResult.locate?.(["steps", "start-step", "next"]);
    const crlfLoc = crlfResult.locate?.(["steps", "start-step", "next"]);
    expect(lfLoc).toBeDefined();
    expect(crlfLoc).toEqual(lfLoc);
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

describe("typed events (eventKind, LS305)", () => {
  it("accepts a generic event with no eventKind (backward compatible)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: publish
    event: Thing
    next: fin
  fin:
    type: final
    outcome: success
`);
    const result = parseFeature(source);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a timer event with exactly one of after/at/every", () => {
    for (const timer of ["after: 15m", "at: 2026-01-01T00:00:00Z", "every: 1d"]) {
      const result = parseFeature(
        featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    ${timer}
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`),
      );
      expect(result.ok, timer).toBe(true);
      expect(result.diagnostics, timer).toEqual([]);
    }
  });

  it("accepts message, signal, error and conditional events", () => {
    // Conditionals are catch events, so they wait (LS305); the rest publish.
    const cases = [
      "direction: publish\n    eventKind: message\n    event: Thing\n    next: fin",
      "direction: publish\n    eventKind: signal\n    event: Thing\n    next: fin",
      "direction: publish\n    eventKind: error\n    name: PaymentTimeout\n    next: fin",
      "direction: wait\n    eventKind: conditional\n    when: balance < 0\n    on:\n      received: { next: fin }",
    ];
    for (const body of cases) {
      const result = parseFeature(
        featureWith(`
  start-step:
    type: event
    ${body}
  fin:
    type: final
    outcome: success
`),
      );
      expect(result.ok, body).toBe(true);
      expect(result.diagnostics, body).toEqual([]);
    }
  });

  it("rejects an unknown eventKind with LS002", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: reminder
    event: Thing
    next: fin
  fin:
    type: final
    outcome: success
`),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "LS002")).toBe(true);
  });

  it("requires a timer to set exactly one of after/at/every (LS305)", () => {
    const none = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(none)).toContain("LS305");

    const two = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    after: 5m
    every: 1d
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(two)).toContain("LS305");
  });

  it("rejects a timer that also names an event (LS305)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    after: 5m
    event: Thing
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS305");
  });

  it("requires message/signal/generic events to name an event (LS305)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: message
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS305");
  });

  it("rejects timer fields on a message event (LS305)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: message
    event: Thing
    after: 5m
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS305");
  });

  it("requires a conditional event to set when (LS305)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: conditional
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS305");
  });

  it("rejects a published timer or conditional — they are catch events (LS305)", () => {
    const publishedTimer = featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: timer
    after: 5m
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(publishedTimer)).toContain("LS305");

    const publishedConditional = featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: conditional
    when: balance < 0
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(publishedConditional)).toContain("LS305");
  });

  it("rejects a blank timer field and a blank conditional when (LS305)", () => {
    const blankAt = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    at: ""
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(blankAt)).toContain("LS305");

    const blankWhen = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: conditional
    when: "   "
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    expect(codes(blankWhen)).toContain("LS305");
  });

  it("rejects a blank error name (LS305)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: publish
    eventKind: error
    name: ""
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS305");
  });

  it('rejects a blank FORBIDDEN field (timer with name: "") — LS305', () => {
    // A forbidden field that is present but blank must still be rejected: the
    // forbidden-field check tests raw presence, not blank-aware presence.
    const source = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    after: 5m
    name: ""
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS305")).toBe(true);
    // The diagnostic points at the offending forbidden field.
    expect(
      diagnostics.some((d) => d.code === "LS305" && d.message.includes('must not set "name"')),
    ).toBe(true);
  });
});

describe("blank descriptive guards (LS306)", () => {
  it("rejects a blank when guard on an operation outcome", () => {
    const source = featureWith(`
  start-step:
    type: operation
    on:
      success:
        when: ""
        next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS306");
  });

  it("rejects a blank when guard on a page action", () => {
    const source = featureWith(`
  start-step:
    type: page
    actions:
      go:
        when: "   "
        next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).toContain("LS306");
  });

  it("accepts a non-blank guard", () => {
    const source = featureWith(`
  start-step:
    type: operation
    on:
      success:
        when: the slot is still free
        next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codes(source)).not.toContain("LS306");
  });
});

describe("typed terminal states (terminate)", () => {
  it("accepts a final with terminate: true", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: failure
    terminate: true
`),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a non-boolean terminate with LS002", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
    terminate: "yes"
`),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "LS002")).toBe(true);
  });
});

describe("transition guards (when)", () => {
  it("accepts guards on operation outcomes and page actions", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: page
    actions:
      go:
        when: user is signed in
        next: work
  work:
    type: operation
    on:
      success:
        when: the call succeeds
        next: fin
      error:
        next: fin
  fin:
    type: final
    outcome: success
`),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a non-string guard with LS002", () => {
    const result = parseFeature(
      featureWith(`
  start-step:
    type: operation
    on:
      success:
        when: 123
        next: fin
  fin:
    type: final
    outcome: success
`),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "LS002")).toBe(true);
  });
});
