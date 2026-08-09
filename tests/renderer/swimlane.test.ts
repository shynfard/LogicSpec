import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildGraph, normalizeFeature, parseFeature, renderMermaid } from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("mermaid swimlane renderer (experimental)", () => {
  it("groups steps into actor lanes deterministically (golden)", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "examples/booking/booking.feature.yaml"),
      "utf8",
    );
    const parsed = parseFeature(source);
    if (!parsed.data) throw new Error("booking example must parse");
    const feature = normalizeFeature(parsed.data);
    const graph = buildGraph(feature);

    const output = renderMermaid(feature, graph, { view: "swimlane" });
    expect(output).toBe(renderMermaid(feature, graph, { view: "swimlane" }));
    expect(output).toContain('subgraph lane_0["Web App (frontend)"]');
    expect(output).toContain('subgraph lane_1["Booking Service (service)"]');
    expect(output).toContain('"Unassigned"');
    expect(output).toMatchSnapshot();
  });
});
