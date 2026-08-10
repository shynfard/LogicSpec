import { describe, expect, it } from "vitest";
import { buildGraph, normalizeFeature, parseFeature } from "logicspec/core";
import { derive, toFlow, uniqueStepId } from "../src/lib/editorState";
import { SEED_YAML } from "../src/lib/seed";

describe("seed round trip", () => {
  it("parses the seed and aligns flow edges 1:1 with buildGraph edges", () => {
    const parsed = parseFeature(SEED_YAML);
    expect(parsed.ok).toBe(true);
    const data = parsed.data;
    if (!data) throw new Error("seed must parse");

    const feature = normalizeFeature(data);
    const graph = buildGraph(feature);
    const flow = toFlow(feature, graph);

    expect(flow.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(flow.edges.map((edge) => ({ from: edge.source, to: edge.target }))).toEqual(
      graph.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    );
    for (const edge of flow.edges) {
      const path = edge.data?.path;
      expect(path).toBeDefined();
      expect(path?.length).toBeGreaterThan(0);
      expect(path?.[path.length - 1]).toBe("next");
    }
  });

  it("derive exposes a graph, diagnostics and validity for the seed", () => {
    const derived = derive(SEED_YAML);
    expect(derived.feature?.id).toBe("signup");
    expect(derived.graph?.start).toBe("signup-page");
    // The seed has no error-severity findings (info-level advisories may exist).
    expect(derived.valid).toBe(true);
    expect(derived.diagnostics.every((d) => d.severity !== "error")).toBe(true);
  });

  it("keeps the last good graph flow when the YAML breaks", () => {
    const derived = derive("version: [broken");
    expect(derived.graph).toBeUndefined();
    expect(derived.valid).toBe(false);
    expect(derived.diagnostics[0]?.code).toBe("LS001");
  });

  it("generates fresh step ids that avoid collisions", () => {
    const parsed = parseFeature(SEED_YAML);
    if (!parsed.data) throw new Error("seed must parse");
    const feature = normalizeFeature(parsed.data);
    expect(uniqueStepId(feature, "page")).toBe("page-1");
    expect(uniqueStepId(undefined, "operation")).toBe("operation-1");
  });
});
