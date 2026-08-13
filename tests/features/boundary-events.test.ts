import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  normalizeFeature,
  parseEvents,
  parseFeature,
  renderMermaid,
  validateFeature,
} from "../../src/index.js";
import { featureWith } from "../helpers.js";

/** A minimal event catalog for boundary event-name resolution (LS105). */
const EVENTS = parseEvents(`
version: "1"
events:
  OrderPaid:
    topic: order.paid
`).data;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Structural (file-local) diagnostic codes for a source string. */
function structuralCodes(source: string): string[] {
  return parseFeature(source).diagnostics.map((d) => d.code);
}

/** Full-pipeline diagnostic codes (structural + semantic) for a source string. */
function allCodes(source: string): string[] {
  return validateFeature(source).diagnostics.map((d) => d.code);
}

/** Wraps a start-step block with two shared finals (`done`, `diverted`). */
function feat(startStep: string): string {
  return featureWith(`${startStep}
  done:
    type: final
    outcome: success
  diverted:
    type: final
    outcome: failure
`);
}

/** A page host with an action to `done` and the given boundary list. */
function pageWithBoundary(boundaryList: string): string {
  return feat(`  start-step:
    type: page
    label: Home
    boundary:
${boundaryList}
    actions:
      go:
        next: done`);
}

describe("boundary events — valid per kind (LS308)", () => {
  it("accepts a timer boundary on a page (after)", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        next: diverted`);
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a message boundary on a subflow (event name)", () => {
    const source = feat(`  start-step:
    type: subflow
    flow: child
    next: done
    boundary:
      - eventKind: message
        event: OrderPaid
        next: diverted`);
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts an error boundary on a subflow", () => {
    const source = feat(`  start-step:
    type: subflow
    flow: child
    next: done
    boundary:
      - eventKind: error
        name: OutOfStock
        next: diverted`);
    expect(validateFeature(source).diagnostics).toEqual([]);
  });

  it("accepts a conditional boundary on a parallel region", () => {
    const source = feat(`  start-step:
    type: parallel
    branches:
      a:
        flow: child
    next: done
    boundary:
      - eventKind: conditional
        when: the region has run longer than the SLA
        next: diverted`);
    expect(validateFeature(source).diagnostics).toEqual([]);
  });

  it("accepts a timer boundary using `every` and a signal boundary", () => {
    const source = feat(`  start-step:
    type: parallel
    branches:
      a:
        flow: child
    next: done
    boundary:
      - eventKind: timer
        every: 1h
        next: diverted
      - eventKind: signal
        event: Abort
        next: diverted`);
    expect(validateFeature(source).diagnostics).toEqual([]);
  });
});

describe("boundary events — invalid per kind (LS308)", () => {
  it("rejects a timer boundary with two of after/at/every", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        at: 2026-01-01
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });

  it("rejects a timer boundary with none of after/at/every", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });

  it("rejects a message boundary with no event name", () => {
    const source = pageWithBoundary(`      - eventKind: message
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });

  it("rejects a conditional boundary with no `when`", () => {
    const source = pageWithBoundary(`      - eventKind: conditional
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });

  it("rejects a foreign field on a boundary (a timer that also names an event)", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        event: Nope
        next: diverted`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS308")).toBe(true);
    expect(
      diagnostics.some((d) => d.code === "LS308" && d.message.includes('must not set "event"')),
    ).toBe(true);
  });

  it('rejects a blank required boundary field (conditional with when: "")', () => {
    const source = pageWithBoundary(`      - eventKind: conditional
        when: "   "
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });
});

describe("boundary events — disallowed step types (LS308)", () => {
  it("rejects a boundary on an operation and points at `on`", () => {
    const source = feat(`  start-step:
    type: operation
    call: svc.op
    next: done
    boundary:
      - eventKind: timer
        after: 15m
        next: diverted`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS308")).toBe(true);
    expect(
      diagnostics.some(
        (d) => d.code === "LS308" && d.message.includes('already handles outcomes with "on"'),
      ),
    ).toBe(true);
    // A disallowed boundary produces no phantom edge, so no spurious LS101.
    expect(allCodes(source)).not.toContain("LS101");
  });

  it("rejects a boundary on a waiting event and mentions on.timeout", () => {
    const source = feat(`  start-step:
    type: event
    direction: wait
    event: Something
    on:
      received:
        next: done
    boundary:
      - eventKind: timer
        after: 15m
        next: diverted`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS308" && d.message.includes("on.timeout"))).toBe(
      true,
    );
  });

  it("rejects a boundary on a wait step", () => {
    const source = feat(`  start-step:
    type: wait
    duration: 10m
    next: done
    boundary:
      - eventKind: timer
        after: 15m
        next: diverted`);
    expect(structuralCodes(source)).toContain("LS308");
  });
});

describe("boundary events — target resolution & reachability", () => {
  it("resolves the boundary `next` through the normal target machinery (LS101)", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        next: nowhere`);
    const diagnostics = validateFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS101" && d.message.includes("nowhere"))).toBe(true);
  });

  it("treats a boundary target as a real edge for reachability (no false LS200)", () => {
    // `diverted` is reachable ONLY through the page's boundary event.
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        next: diverted`);
    expect(allCodes(source)).not.toContain("LS200");
  });
});

describe("boundary events — model & rendering", () => {
  it("exposes boundaries on the graph node and produces a boundary edge", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        interrupting: false
        label: idle
        next: diverted`);
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("must parse");
    const feature = normalizeFeature(parsed.data);
    const graph = buildGraph(feature);

    const node = graph.nodes.find((n) => n.id === "start-step");
    expect(node?.boundaries).toHaveLength(1);
    expect(node?.boundaries?.[0]).toMatchObject({
      eventKind: "timer",
      interrupting: false,
      next: "diverted",
    });

    const edge = graph.edges.find((e) => e.from === "start-step" && e.to === "diverted");
    expect(edge?.kind).toBe("boundary");
  });

  it("defaults interrupting to true when omitted", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        next: diverted`);
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("must parse");
    const graph = buildGraph(normalizeFeature(parsed.data));
    expect(graph.nodes.find((n) => n.id === "start-step")?.boundaries?.[0]?.interrupting).toBe(
      true,
    );
  });

  it("renders a non-interrupting boundary as a labelled edge with the suffix", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        interrupting: false
        next: diverted`);
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("must parse");
    const feature = normalizeFeature(parsed.data);
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });
    expect(output).toContain('start_step -- "⏱ after 15m (non-interrupting)" --> diverted');
  });
});

describe("boundary events — catalog resolution (LS105)", () => {
  /** A subflow host with a single message/signal boundary naming `event`. */
  function subflowWithEventBoundary(kind: string, event: string): string {
    return feat(`  start-step:
    type: subflow
    flow: child
    next: done
    boundary:
      - eventKind: ${kind}
        event: ${event}
        next: diverted`);
  }

  it("flags an unknown message boundary event against the catalog (LS105)", () => {
    const source = subflowWithEventBoundary("message", "Unknownish");
    const diagnostics = validateFeature(source, { events: EVENTS }).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS105" && d.message.includes("Unknownish"))).toBe(
      true,
    );
  });

  it("flags an unknown signal boundary event against the catalog (LS105)", () => {
    const source = subflowWithEventBoundary("signal", "Nopeish");
    const diagnostics = validateFeature(source, { events: EVENTS }).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS105" && d.message.includes("Nopeish"))).toBe(true);
  });

  it("accepts a known message boundary event name (no LS105, clean)", () => {
    const source = subflowWithEventBoundary("message", "OrderPaid");
    const result = validateFeature(source, { events: EVENTS });
    expect(result.diagnostics.some((d) => d.code === "LS105")).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("does not run the catalog check for non message/signal kinds (timer)", () => {
    const source = pageWithBoundary(`      - eventKind: timer
        after: 15m
        next: diverted`);
    expect(validateFeature(source, { events: EVENTS }).diagnostics).toEqual([]);
  });
});

describe("boundary events — resource bounds (LS308 DoS guard)", () => {
  it("rejects an over-limit boundary array with LS308, not a hang", () => {
    const handlers = Array.from(
      { length: 1001 },
      () => "      - eventKind: timer\n        after: 15m\n        next: diverted",
    ).join("\n");
    const source = pageWithBoundary(handlers);
    const started = Date.now();
    const result = validateFeature(source);
    // Rejected promptly by the schema bound, well under any DoS threshold —
    // normalization/graph work (the O(handlers·steps) suggest pass) never runs.
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.code === "LS308" && d.message.includes("more than 1000 boundary handlers"),
      ),
    ).toBe(true);
  });

  it("rejects a boundary field longer than the cap with LS308", () => {
    const source = pageWithBoundary(`      - eventKind: conditional
        when: "${"x".repeat(600)}"
        next: diverted`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS308" && d.message.includes("characters"))).toBe(
      true,
    );
  });
});

describe("boundary-events example (examples/fulfillment)", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "examples/fulfillment/order-fulfillment.feature.yaml"),
    "utf8",
  );

  it("validates with no diagnostics at all", () => {
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("renders each boundary kind as a plain labelled edge (golden)", () => {
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("fulfillment example must parse");
    const feature = normalizeFeature(parsed.data);
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });

    expect(output).toContain('checkout -- "⏱ after 15m session idle" --> session_expired');
    expect(output).toContain(
      'checkout -- "✉ on-message PriceChanged (non-interrupting)" --> refresh_prices',
    );
    expect(output).toContain('fulfil -- "⚠ on-error OutOfStock" --> backorder');
    expect(output).toContain(
      'notify -- "⏱ after 1h notifications slow (non-interrupting)" --> escalate_notifications',
    );

    expect(output).toMatchSnapshot();
  });
});
