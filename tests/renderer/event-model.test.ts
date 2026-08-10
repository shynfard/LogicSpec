import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  type FeatureGraph,
  type NormalizedFeature,
  normalizeFeature,
  parseFeature,
} from "../../src/index.js";
import { renderMermaidEventModel } from "../../src/renderers/mermaid-event-model.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function modelOf(source: string): { feature: NormalizedFeature; graph: FeatureGraph } {
  const parsed = parseFeature(source);
  if (!parsed.data) throw new Error(`fixture must parse: ${JSON.stringify(parsed.diagnostics)}`);
  const feature = normalizeFeature(parsed.data);
  return { feature, graph: buildGraph(feature) };
}

function bookingModel(): { feature: NormalizedFeature; graph: FeatureGraph } {
  const source = fs.readFileSync(path.join(ROOT, "examples/booking/booking.feature.yaml"), "utf8");
  return modelOf(source);
}

describe("mermaid event-model renderer (experimental)", () => {
  it("renders the booking example deterministically (golden)", () => {
    const { feature, graph } = bookingModel();
    const first = renderMermaidEventModel(feature, graph);
    expect(first).toBe(renderMermaidEventModel(feature, graph));
    expect(first.startsWith("flowchart LR")).toBe(true);
    expect(first).toMatchSnapshot();
  });

  it("groups steps into construct lanes in fixed order", () => {
    const { feature, graph } = bookingModel();
    const output = renderMermaidEventModel(feature, graph);
    const interfaceAt = output.indexOf('subgraph lane_interface["Interface"]');
    const logicAt = output.indexOf('subgraph lane_logic["Logic"]');
    const eventsAt = output.indexOf('subgraph lane_events["Events"]');
    const outcomesAt = output.indexOf('subgraph lane_outcomes["Outcomes"]');
    expect(interfaceAt).toBeGreaterThan(-1);
    expect(logicAt).toBeGreaterThan(interfaceAt);
    expect(eventsAt).toBeGreaterThan(logicAt);
    expect(outcomesAt).toBeGreaterThan(eventsAt);
    // errors and finals live in the outcomes lane
    const outcomesBlock = output.slice(outcomesAt, output.indexOf("end", outcomesAt));
    expect(outcomesBlock).toContain("slot_conflict[");
    expect(outcomesBlock).toContain("success(((");
  });

  it("keeps the start edge and all transitions", () => {
    const { feature, graph } = bookingModel();
    const output = renderMermaidEventModel(feature, graph);
    expect(output).toContain("START --> select_service");
    expect(output).toContain('check_availability -- "available" --> select_time');
  });

  it("omits empty lanes", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: tiny, name: Tiny }
start: home
steps:
  home:
    type: page
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaidEventModel(feature, graph);
    expect(output).toContain("lane_interface");
    expect(output).toContain("lane_outcomes");
    expect(output).not.toContain("lane_logic");
    expect(output).not.toContain("lane_events");
  });
});
