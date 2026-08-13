import type { FeatureGraph, GraphZone } from "../graph/edges.js";
import type { RenderDirection } from "../schema/config.js";
import {
  CLASS_DEFS,
  edgeArrow,
  escapeMermaid,
  NodeIdAllocator,
  nodeDeclaration,
  START_NODE_ID,
  startDeclaration,
} from "./mermaid-common.js";

export interface FlowchartOptions {
  direction?: RenderDirection;
}

/** Subgraph title for an agent zone, e.g. "🤖 AI Triage". */
function zoneTitle(zone: GraphZone): string {
  return `🤖 ${zone.label}`;
}

/**
 * Renders the default flowchart view. Output is fully deterministic:
 * nodes and edges appear in source order.
 *
 * Agent zones render as labelled subgraphs ("clusters") around their member
 * steps — a descriptive boundary, never a control-flow construct. A step not in
 * any zone is declared at the top level exactly as before, so a feature without
 * zones renders byte-for-byte as it always has.
 */
export function renderMermaidFlowchart(
  graph: FeatureGraph,
  options: FlowchartOptions = {},
): string {
  const direction = options.direction ?? "TD";
  const ids = new NodeIdAllocator();
  const lines: string[] = [`flowchart ${direction}`];

  const known = new Set(graph.nodes.map((n) => n.id));
  // Map each real step to the first zone (source order) that claims it, so a
  // node is declared exactly once even if a malformed doc lists it twice.
  const zoneOfStep = new Map<string, number>();
  graph.zones.forEach((zone, zoneIndex) => {
    for (const stepId of zone.steps) {
      if (known.has(stepId) && !zoneOfStep.has(stepId)) zoneOfStep.set(stepId, zoneIndex);
    }
  });

  lines.push(`  ${startDeclaration()}`);
  // Steps outside every zone, in source order (identical to the zone-free path).
  for (const node of graph.nodes) {
    if (zoneOfStep.has(node.id)) continue;
    lines.push(`  ${nodeDeclaration(node, ids.id(node.id))}`);
  }
  // Each zone as a subgraph around its member steps, in source order.
  graph.zones.forEach((zone, zoneIndex) => {
    const members = graph.nodes.filter((node) => zoneOfStep.get(node.id) === zoneIndex);
    if (members.length === 0) return; // never emit an empty cluster
    // Reserve the subgraph id through the same allocator the step nodes use, so a
    // step legitimately named `zone_N` and this cluster can never share an id.
    // Reserving before the members are declared keeps the natural `zone_N` id for
    // the subgraph (byte-identical output when no step collides).
    const zoneId = ids.reserve(`zone_${zoneIndex}`);
    lines.push(`  subgraph ${zoneId}["${escapeMermaid(zoneTitle(zone))}"]`);
    for (const node of members) {
      lines.push(`    ${nodeDeclaration(node, ids.id(node.id))}`);
    }
    lines.push("  end");
  });

  lines.push("");
  if (known.has(graph.start)) {
    lines.push(`  ${START_NODE_ID} --> ${ids.id(graph.start)}`);
  }
  for (const edge of graph.edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    lines.push(
      `  ${ids.id(edge.from)} ${edgeArrow(edge.kind, edge.label, edge.guard)} ${ids.id(edge.to)}`,
    );
  }

  lines.push("");
  for (const def of CLASS_DEFS) lines.push(`  ${def}`);

  return `${lines.join("\n")}\n`;
}
