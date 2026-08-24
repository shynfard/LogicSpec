import { describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph/edges.js";
import { normalizeFeature } from "../../src/graph/normalize.js";
import type { FeatureFile } from "../../src/schema/feature.js";
import { buildNodeClickMap } from "../../src/server/click-map.js";

const feature: FeatureFile = {
  version: "1",
  feature: { id: "test", name: "Test" },
  start: "s1",
  steps: {
    s1: { type: "subflow", flow: "other-feature", next: "s2" },
    s2: { type: "final", outcome: "success" },
  },
};

describe("buildNodeClickMap", () => {
  it("maps a subflow step's node to its target feature id", () => {
    const normalized = normalizeFeature(feature);
    const graph = buildGraph(normalized);
    const map = buildNodeClickMap(normalized, graph);

    const entries = Object.values(map);
    const subflowEntry = entries.find((e) => e.stepId === "s1");
    const finalEntry = entries.find((e) => e.stepId === "s2");

    expect(subflowEntry).toEqual({ stepId: "s1", flow: "other-feature" });
    expect(finalEntry).toEqual({ stepId: "s2" });
  });
});
