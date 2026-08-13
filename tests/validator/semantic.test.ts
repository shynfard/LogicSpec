import { describe, expect, it } from "vitest";
import {
  type FeatureFile,
  parseEvents,
  parseServices,
  type ValidateOptions,
  validateFeature,
} from "../../src/index.js";
import { featureWith } from "../helpers.js";

function codesOf(source: string, options: ValidateOptions = {}): string[] {
  return validateFeature(source, options).diagnostics.map((d) => d.code);
}

const SERVICES = parseServices(`
version: "1"
services:
  booking:
    operations:
      reserve-slot: { kind: http, method: POST, path: /reservations }
`).data;

const EVENTS = parseEvents(`
version: "1"
events:
  BookingCreated:
    topic: booking.created
`).data;

describe("semantic validation", () => {
  it("reports LS100 for an unknown start with a suggestion", () => {
    const result = validateFeature(`
version: "1"
feature: { id: demo, name: Demo }
start: hme
steps:
  home:
    type: final
    outcome: success
`);
    const diagnostic = result.diagnostics.find((d) => d.code === "LS100");
    expect(diagnostic?.suggestion).toBe("home");
    expect(result.valid).toBe(false);
  });

  it("reports LS101 for an unknown transition target with a suggestion", () => {
    const source = featureWith(`
  start-step:
    type: page
    actions:
      go: { next: chekout }
  checkout:
    type: page
    actions:
      pay: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const result = validateFeature(source);
    const diagnostic = result.diagnostics.find((d) => d.code === "LS101");
    expect(diagnostic?.suggestion).toBe("checkout");
    expect(diagnostic?.path).toEqual(["steps", "start-step", "actions", "go", "next"]);
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
  });

  it("reports LS102 for an unknown actor", () => {
    const source = featureWith(
      `
  start-step:
    type: page
    actor: payments
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`,
      `actors:
  payment:
    kind: service
`,
    );
    const diagnostic = validateFeature(source).diagnostics.find((d) => d.code === "LS102");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.suggestion).toBe("payment");
  });

  it("reports LS103 for unknown context variables", () => {
    const source = featureWith(
      `
  start-step:
    type: operation
    requires: [reservationIDX]
    next: fin
  fin:
    type: final
    outcome: success
`,
      `context:
  reservationId:
    type: string
`,
    );
    const diagnostic = validateFeature(source).diagnostics.find((d) => d.code === "LS103");
    expect(diagnostic?.suggestion).toBe("reservationId");
  });

  it("reports LS104 for unknown services and operations when a catalog is present", () => {
    const unknownOperation = featureWith(`
  start-step:
    type: operation
    call: booking.resreve-slot
    next: fin
  fin:
    type: final
    outcome: success
`);
    const diagnostics = validateFeature(unknownOperation, { services: SERVICES }).diagnostics;
    const diagnostic = diagnostics.find((d) => d.code === "LS104");
    expect(diagnostic?.suggestion).toBe("booking.reserve-slot");

    const unknownService = featureWith(`
  start-step:
    type: operation
    call: bookings.reserve-slot
    next: fin
  fin:
    type: final
    outcome: success
`);
    expect(codesOf(unknownService, { services: SERVICES })).toContain("LS104");
    // Without a catalog the check is skipped entirely.
    expect(codesOf(unknownService)).not.toContain("LS104");
  });

  it("reports LS105 for unknown events when a catalog is present", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: publish
    event: BookingCreatd
    next: fin
  fin:
    type: final
    outcome: success
`);
    const diagnostic = validateFeature(source, { events: EVENTS }).diagnostics.find(
      (d) => d.code === "LS105",
    );
    expect(diagnostic?.suggestion).toBe("BookingCreated");
    expect(codesOf(source)).not.toContain("LS105");
  });

  it("reports LS106 for unknown subflows when workspace flows are known", () => {
    const source = featureWith(`
  start-step:
    type: subflow
    flow: paymnt
    next: fin
  fin:
    type: final
    outcome: success
`);
    const knownFlows = new Set(["payment", "notification"]);
    const diagnostic = validateFeature(source, { knownFlows }).diagnostics.find(
      (d) => d.code === "LS106",
    );
    expect(diagnostic?.suggestion).toBe("payment");
    expect(codesOf(source)).not.toContain("LS106");
  });

  it("reports LS107 when a page load targets an undeclared state", () => {
    const source = featureWith(`
  start-step:
    type: page
    states: [ready, error]
    load:
      - call: booking.reserve-slot
        on:
          success: redy
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const diagnostic = validateFeature(source).diagnostics.find((d) => d.code === "LS107");
    expect(diagnostic?.suggestion).toBe("ready");
  });

  it("reports LS200 (warning) for unreachable steps", () => {
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
    const result = validateFeature(source);
    const diagnostic = result.diagnostics.find((d) => d.code === "LS200");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("island");
    expect(result.valid).toBe(true); // warnings do not fail validation
  });

  it("reports LS201 for dead-end steps", () => {
    const source = featureWith(`
  start-step:
    type: page
  fin:
    type: final
    outcome: success
`);
    expect(codesOf(source)).toContain("LS201");
  });

  it("accepts a legitimate retry loop", () => {
    const source = featureWith(`
  start-step:
    type: page
    actions:
      go: { next: reserve }
  reserve:
    type: operation
    on:
      success: { next: fin }
      conflict: { next: start-step }
  fin:
    type: final
    outcome: success
`);
    const result = validateFeature(source);
    expect(result.valid).toBe(true);
    expect(result.diagnostics.filter((d) => d.code === "LS202")).toEqual([]);
  });

  it("reports LS202 for a loop with no path to any terminal", () => {
    const source = featureWith(`
  start-step:
    type: page
    actions:
      go: { next: ping }
  ping:
    type: page
    actions:
      go: { next: pong }
  pong:
    type: page
    actions:
      go: { next: ping }
  fin:
    type: final
    outcome: success
`);
    const result = validateFeature(source);
    const diagnostic = result.diagnostics.find((d) => d.code === "LS202");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain("ping");
    expect(diagnostic?.message).toContain("pong");
    expect(result.valid).toBe(false);
  });

  it("treats an actionless error as a terminal (no LS202, no LS201)", () => {
    const source = featureWith(`
  start-step:
    type: operation
    on:
      retry: { next: start-step }
      fail: { next: broken }
  broken:
    type: error
    message: Fatal.
`);
    const result = validateFeature(source);
    expect(result.diagnostics.filter((d) => d.code === "LS202")).toEqual([]);
    expect(result.diagnostics.filter((d) => d.code === "LS201")).toEqual([]);
  });

  it("does not resolve a nameless timer event against the event catalog (no LS105)", () => {
    const source = featureWith(`
  start-step:
    type: event
    direction: wait
    eventKind: timer
    after: 30d
    on:
      received: { next: fin }
  fin:
    type: final
    outcome: failure
`);
    const result = validateFeature(source, { events: EVENTS });
    expect(result.diagnostics.filter((d) => d.code === "LS105")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("emits LS400 info when no failure outcome exists", () => {
    const source = featureWith(`
  start-step:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const result = validateFeature(source);
    const diagnostic = result.diagnostics.find((d) => d.code === "LS400");
    expect(diagnostic?.severity).toBe("info");
    expect(result.valid).toBe(true);
  });
});

describe("object-input validation does not bypass structural checks", () => {
  it("runs LS305 on an already-parsed object (timer with no after/at/every)", () => {
    const feature: FeatureFile = {
      version: "1",
      feature: { id: "demo", name: "Demo" },
      start: "ev",
      steps: {
        ev: {
          type: "event",
          direction: "wait",
          eventKind: "timer",
          on: { received: { next: "fin" } },
        },
        fin: { type: "final", outcome: "success" },
      },
    };
    const result = validateFeature(feature);
    expect(result.diagnostics.map((d) => d.code)).toContain("LS305");
    expect(result.valid).toBe(false);
  });

  it("runs LS305 on an object generic event with no event name", () => {
    const feature: FeatureFile = {
      version: "1",
      feature: { id: "demo", name: "Demo" },
      start: "ev",
      steps: {
        ev: { type: "event", direction: "publish", next: "fin" },
        fin: { type: "final", outcome: "success" },
      },
    };
    const result = validateFeature(feature);
    expect(result.diagnostics.map((d) => d.code)).toContain("LS305");
    expect(result.valid).toBe(false);
  });

  it("still accepts a structurally valid object", () => {
    const feature: FeatureFile = {
      version: "1",
      feature: { id: "demo", name: "Demo" },
      start: "fin",
      steps: { fin: { type: "final", outcome: "success" } },
    };
    expect(validateFeature(feature).valid).toBe(true);
  });
});
