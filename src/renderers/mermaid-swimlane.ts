import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
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

export interface SwimlaneOptions {
  direction?: RenderDirection;
}

interface Lane {
  key: string;
  title: string;
  nodeIds: string[];
}

/**
 * EXPERIMENTAL: groups steps into per-actor subgraphs ("lanes").
 * Uses plain flowchart subgraphs for maximum renderer compatibility;
 * a dedicated swimlane syntax can replace this once Mermaid support
 * is widespread.
 */
export function renderMermaidSwimlane(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  options: SwimlaneOptions = {},
): string {
  const direction = options.direction ?? "TD";
  const ids = new NodeIdAllocator();
  const lines: string[] = [`flowchart ${direction}`];

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const laneOrder: Lane[] = [];
  const laneByKey = new Map<string, Lane>();

  const laneFor = (actorId: string | undefined): Lane => {
    const key = actorId ?? "__none";
    const existing = laneByKey.get(key);
    if (existing) return existing;
    const actor = actorId === undefined ? undefined : feature.actors.find((a) => a.id === actorId);
    const title =
      actorId === undefined ? "Unassigned" : actor ? `${actor.label} (${actor.kind})` : actorId;
    const lane: Lane = { key, title, nodeIds: [] };
    laneByKey.set(key, lane);
    laneOrder.push(lane);
    return lane;
  };

  // Seed lanes in actor declaration order so lane order is deterministic.
  for (const actor of feature.actors) laneFor(actor.id);
  for (const step of feature.steps) laneFor(step.actor).nodeIds.push(step.id);

  lines.push(`  ${startDeclaration()}`);
  let laneIndex = 0;
  for (const lane of laneOrder) {
    if (lane.nodeIds.length === 0) continue;
    lines.push(`  subgraph lane_${laneIndex}["${escapeMermaid(lane.title)}"]`);
    lines.push("    direction TB");
    for (const nodeId of lane.nodeIds) {
      const node = nodeById.get(nodeId);
      if (node) lines.push(`    ${nodeDeclaration(node, ids.id(node.id))}`);
    }
    lines.push("  end");
    laneIndex += 1;
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
