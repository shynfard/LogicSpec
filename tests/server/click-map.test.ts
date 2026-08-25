import { describe, expect, it } from "vitest";
import { buildGraph } from "../../src/graph/edges.js";
import { normalizeFeature } from "../../src/graph/normalize.js";
import type { FeatureFile } from "../../src/schema/feature.js";
import { buildNodeClickMap } from "../../src/server/click-map.js";

const feature: FeatureFile = {
  version: "1",
  feature: { id: "test", name: "Test" },
  start: "select-service",
  steps: {
    "select-service": { type: "subflow", flow: "other-feature", next: "reserve-slot" },
    "reserve-slot": { type: "final", outcome: "success" },
  },
};

describe("buildNodeClickMap", () => {
  it("maps a subflow step's node to its target feature id", () => {
    const normalized = normalizeFeature(feature);
    const graph = buildGraph(normalized);
    const map = buildNodeClickMap(normalized, graph);

    const entries = Object.values(map);
    const subflowEntry = entries.find((e) => e.stepId === "select-service");
    const finalEntry = entries.find((e) => e.stepId === "reserve-slot");

    expect(subflowEntry).toEqual({ stepId: "select-service", flow: "other-feature" });
    expect(finalEntry).toEqual({ stepId: "reserve-slot" });
  });

  it("keys entries by the raw step id, not a Mermaid-sanitized id", () => {
    // The interactive canvas (client/src/pages/feature-detail/Canvas.tsx)
    // looks up `clickMap[node.id]` where `node.id` is the raw step id used
    // throughout `diagram.steps`/`diagram.edges` — never the Mermaid node id
    // (which sanitizes hyphens to underscores). These fixture ids contain a
    // hyphen specifically so the raw id ("select-service") and the
    // Mermaid-sanitized id ("select_service") genuinely diverge — guarding
    // against silently reverting to the mermaid-id keying this function
    // used before. (A hyphen-free fixture like "s1"/"s2" would sanitize to
    // itself and pass under either keying scheme, making this assertion
    // vacuous.)
    const normalized = normalizeFeature(feature);
    const graph = buildGraph(normalized);
    const map = buildNodeClickMap(normalized, graph);

    expect(map["select-service"]).toEqual({ stepId: "select-service", flow: "other-feature" });
    expect(map["reserve-slot"]).toEqual({ stepId: "reserve-slot" });
    expect(map.select_service).toBeUndefined();
    expect(map.reserve_slot).toBeUndefined();
  });
});
