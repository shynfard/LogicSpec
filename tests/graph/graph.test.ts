import { describe, expect, it } from "vitest";
import { buildGraph, normalizeFeature, parseFeature } from "../../src/index.js";

const SOURCE = `
version: "1"
feature: { id: g, name: Graph }
start: home
steps:
  home:
    type: page
    actions:
      go:
        label: Go
        next: decide
  decide:
    type: decision
    cases:
      - when: x > 0
        next: work
    default:
      next: fail
  work:
    type: operation
    on:
      success: { next: announce }
      error: { next: fail }
  announce:
    type: event
    direction: publish
    event: Done
    next: fin
  fail:
    type: error
    message: Nope.
  fin:
    type: final
    outcome: success
`;

function graphOf() {
  const parsed = parseFeature(SOURCE);
  if (!parsed.data) throw new Error("fixture must parse");
  return buildGraph(normalizeFeature(parsed.data));
}

describe("buildGraph", () => {
  it("builds edges with the right kinds and labels", () => {
    const graph = graphOf();
    expect(graph.edges).toEqual([
      { from: "home", to: "decide", kind: "action", label: "Go" },
      { from: "decide", to: "work", kind: "decision", label: "x > 0" },
      { from: "decide", to: "fail", kind: "default", label: "default" },
      { from: "work", to: "announce", kind: "outcome", label: "success" },
      { from: "work", to: "fail", kind: "outcome", label: "error" },
      { from: "announce", to: "fin", kind: "next", label: undefined },
    ]);
  });

  it("collects terminals: finals plus actionless errors", () => {
    const graph = graphOf();
    expect(graph.terminals).toEqual(["fail", "fin"]);
  });

  it("preserves source order of nodes", () => {
    const graph = graphOf();
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "home",
      "decide",
      "work",
      "announce",
      "fail",
      "fin",
    ]);
    expect(graph.nodes.find((n) => n.id === "fin")?.outcome).toBe("success");
  });

  it("labels event-wait transitions as event edges", () => {
    const parsed = parseFeature(`
version: "1"
feature: { id: w, name: Waits }
start: wait-pay
steps:
  wait-pay:
    type: event
    direction: wait
    event: PaymentCompleted
    timeout: 15m
    on:
      received: { next: fin }
      timeout: { next: expired }
  expired:
    type: error
  fin:
    type: final
    outcome: success
`);
    if (!parsed.data) throw new Error("fixture must parse");
    const graph = buildGraph(normalizeFeature(parsed.data));
    expect(graph.edges).toEqual([
      { from: "wait-pay", to: "fin", kind: "event", label: "received" },
      { from: "wait-pay", to: "expired", kind: "event", label: "timeout 15m" },
    ]);
  });
});
