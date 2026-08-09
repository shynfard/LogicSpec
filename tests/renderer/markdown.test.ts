import { describe, expect, it } from "vitest";
import { buildGraph, normalizeFeature, parseFeature, renderMarkdown } from "../../src/index.js";
import { MINIMAL_FEATURE } from "../helpers.js";

describe("markdown renderer", () => {
  it("wraps the diagram with a generated-file warning and source reference", () => {
    const parsed = parseFeature(MINIMAL_FEATURE);
    if (!parsed.data) throw new Error("fixture must parse");
    const feature = normalizeFeature(parsed.data);
    const graph = buildGraph(feature);

    const markdown = renderMarkdown(feature, graph, { source: "features/demo.feature.yaml" });
    expect(markdown).toContain("# Demo");
    expect(markdown).toContain("GENERATED FILE — DO NOT EDIT.");
    expect(markdown).toContain("Source: `features/demo.feature.yaml`");
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("flowchart TD");
    expect(markdown).toContain("## Actors");
  });
});
