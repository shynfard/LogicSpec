import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";

export interface ClickTarget {
  stepId: string;
  /** Present only when the step is a subflow call — its target feature id. */
  flow?: string;
}

/**
 * Step id → click target for one feature's diagram. Keyed by the raw step
 * id (the same id used in `diagram.steps[].id`/`diagram.edges[].from|to`
 * and, in the interactive canvas, the React Flow node id) — NOT the
 * Mermaid-sanitized node id `mermaidNodeIdMap` produces (hyphens become
 * underscores there). The interactive canvas (`Canvas.tsx`) looks nodes up
 * by their own id directly, so this must match that id space; the
 * Mermaid-rendered views currently have no delegated click listener that
 * would need the Mermaid id space instead.
 */
export function buildNodeClickMap(
  normalized: NormalizedFeature,
  graph: FeatureGraph,
): Record<string, ClickTarget> {
  const byStepId = new Map(normalized.steps.map((s) => [s.id, s]));
  const map: Record<string, ClickTarget> = {};
  for (const node of graph.nodes) {
    const step = byStepId.get(node.id);
    let flow: string | undefined;
    if (step !== undefined && step.def.type === "subflow") flow = step.def.flow;
    map[node.id] = flow !== undefined ? { stepId: node.id, flow } : { stepId: node.id };
  }
  return map;
}
