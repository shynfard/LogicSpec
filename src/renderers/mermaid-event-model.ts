import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import type { StepType } from "../schema/feature.js";
import {
  CLASS_DEFS,
  edgeArrow,
  NodeIdAllocator,
  nodeDeclaration,
  START_NODE_ID,
  startDeclaration,
} from "./mermaid-common.js";

/** Fixed lane order; a lane is omitted entirely when it has no steps. */
const LANES: ReadonlyArray<{ id: string; title: string; types: readonly StepType[] }> = [
  { id: "lane_interface", title: "Interface", types: ["page"] },
  {
    id: "lane_logic",
    title: "Logic",
    types: ["operation", "decision", "subflow", "parallel", "wait"],
  },
  { id: "lane_events", title: "Events", types: ["event"] },
  { id: "lane_outcomes", title: "Outcomes", types: ["final", "error"] },
];

/**
 * EXPERIMENTAL: renders an event-modeling style view — the same graph, but
 * grouped into horizontal lanes by construct kind (interface / logic /
 * events / outcomes) instead of by actor. Approximates the classic
 * event-modeling board with plain flowchart subgraphs so the output renders
 * everywhere Mermaid does.
 */
export function renderMermaidEventModel(feature: NormalizedFeature, graph: FeatureGraph): string {
  const ids = new NodeIdAllocator();
  const lines: string[] = ["flowchart LR"];

  lines.push(`  ${startDeclaration()}`);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const lane of LANES) {
    const members = feature.steps.filter((s) => lane.types.includes(s.type));
    if (members.length === 0) continue;
    lines.push(`  subgraph ${lane.id}["${lane.title}"]`);
    lines.push("    direction LR");
    for (const step of members) {
      const node = nodeById.get(step.id);
      if (node) lines.push(`    ${nodeDeclaration(node, ids.id(node.id))}`);
    }
    lines.push("  end");
  }

  lines.push("");
  const known = new Set(graph.nodes.map((n) => n.id));
  if (known.has(graph.start)) {
    lines.push(`  ${START_NODE_ID} --> ${ids.id(graph.start)}`);
  }
  for (const edge of graph.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    lines.push(`  ${ids.id(edge.from)} ${edgeArrow(edge.kind, edge.label)} ${ids.id(edge.to)}`);
  }

  lines.push("");
  for (const def of CLASS_DEFS) lines.push(`  ${def}`);

  return `${lines.join("\n")}\n`;
}
