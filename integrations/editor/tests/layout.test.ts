import { describe, expect, it } from "vitest";
import type { FeatureGraph } from "logicspec/core";
import { layoutPositions } from "../src/lib/layout";

function fixture(): FeatureGraph {
  return {
    start: "a",
    terminals: ["c"],
    nodes: [
      { id: "a", type: "page", label: "A" },
      { id: "b", type: "operation", label: "B" },
      { id: "c", type: "final", label: "C", outcome: "success" },
      { id: "island", type: "page", label: "Island" },
    ],
    edges: [
      { from: "a", to: "b", kind: "action", label: "go" },
      { from: "b", to: "c", kind: "next" },
    ],
    zones: [],
  };
}

describe("layoutPositions", () => {
  it("assigns columns by BFS depth from start", () => {
    const positions = layoutPositions(fixture());
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({ x: 260, y: 0 });
    expect(positions.get("c")).toEqual({ x: 520, y: 0 });
  });

  it("puts unreachable nodes in a trailing column", () => {
    const positions = layoutPositions(fixture());
    expect(positions.get("island")).toEqual({ x: 780, y: 0 });
  });

  it("stacks same-layer nodes by source order and stays deterministic", () => {
    const graph = fixture();
    graph.edges.push({ from: "a", to: "island", kind: "action", label: "jump" });
    const first = layoutPositions(graph);
    // island is now reachable at depth 1, below b.
    expect(first.get("b")).toEqual({ x: 260, y: 0 });
    expect(first.get("island")).toEqual({ x: 260, y: 120 });
    expect(layoutPositions(graph)).toEqual(first);
  });

  it("handles a graph whose start id does not exist", () => {
    const graph = fixture();
    graph.start = "missing";
    const positions = layoutPositions(graph);
    // Everything is unreachable: single trailing column at x=0, stacked rows.
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({ x: 0, y: 120 });
    expect(positions.get("c")).toEqual({ x: 0, y: 240 });
    expect(positions.get("island")).toEqual({ x: 0, y: 360 });
  });
});
