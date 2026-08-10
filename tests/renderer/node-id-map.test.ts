import { describe, expect, it } from "vitest";
import {
  buildGraph,
  mermaidNodeIdMap,
  normalizeFeature,
  parseFeature,
  renderMermaid,
  workspaceGraphNodeIdMap,
} from "../../src/index.js";
import { MINIMAL_FEATURE } from "../helpers.js";

describe("mermaidNodeIdMap", () => {
  it("maps every rendered flowchart node id back to its step", () => {
    const parsed = parseFeature(MINIMAL_FEATURE);
    if (!parsed.data) throw new Error("fixture must parse");
    const feature = normalizeFeature(parsed.data);
    const graph = buildGraph(feature);
    const output = renderMermaid(feature, graph, { view: "flow" });
    const map = mermaidNodeIdMap(graph);

    expect(new Set(map.values())).toEqual(new Set(graph.nodes.map((n) => n.id)));
    for (const mermaidId of map.keys()) {
      // Node declarations: indented id followed by a shape opener.
      expect(output).toMatch(new RegExp(`^\\s+${mermaidId}[\\[({>]`, "m"));
    }
  });
});

describe("workspaceGraphNodeIdMap", () => {
  it("mirrors the workspace graph's feature node ids", () => {
    const features = [{ id: "booking" }, { id: "notify-booking" }];
    const map = workspaceGraphNodeIdMap(features);
    expect(map.get("feature_booking")).toBe("booking");
    expect(map.get("feature_notify_booking")).toBe("notify-booking");
  });
});
