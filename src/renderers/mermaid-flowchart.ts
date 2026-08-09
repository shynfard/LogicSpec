import type { FeatureGraph } from "../graph/edges.js";
import type { RenderDirection } from "../schema/config.js";
import {
  CLASS_DEFS,
  edgeArrow,
  NodeIdAllocator,
  nodeDeclaration,
  START_NODE_ID,
  startDeclaration,
} from "./mermaid-common.js";

export interface FlowchartOptions {
  direction?: RenderDirection;
}

/**
 * Renders the default flowchart view. Output is fully deterministic:
 * nodes and edges appear in source order.
 */
export function renderMermaidFlowchart(
  graph: FeatureGraph,
  options: FlowchartOptions = {},
): string {
  const direction = options.direction ?? "TD";
  const ids = new NodeIdAllocator();
  const lines: string[] = [`flowchart ${direction}`];

  lines.push(`  ${startDeclaration()}`);
  for (const node of graph.nodes) {
    lines.push(`  ${nodeDeclaration(node, ids.id(node.id))}`);
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
