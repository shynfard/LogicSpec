import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import { mermaidNodeIdMap } from "../renderers/mermaid-common.js";

export interface ClickTarget {
  stepId: string;
  /** Present only when the step is a subflow call — its target feature id. */
  flow?: string;
}

/**
 * Mermaid node id → click target for one feature's diagram. Reuses
 * `mermaidNodeIdMap` (the same id-allocation the VS Code webview uses) so
 * the dashboard's delegated click listener needs no Mermaid `click`
 * directives — those require `securityLevel: "loose"`, already rejected in
 * docs/superpowers/specs/2026-08-10-vscode-clickable-preview-design.md.
 */
export function buildNodeClickMap(
  normalized: NormalizedFeature,
  graph: FeatureGraph,
): Record<string, ClickTarget> {
  const idMap = mermaidNodeIdMap(graph);
  const byStepId = new Map(normalized.steps.map((s) => [s.id, s]));
  const map: Record<string, ClickTarget> = {};
  for (const [mermaidId, stepId] of idMap) {
    const step = byStepId.get(stepId);
    let flow: string | undefined;
    if (step !== undefined && step.def.type === "subflow") flow = step.def.flow;
    map[mermaidId] = flow !== undefined ? { stepId, flow } : { stepId };
  }
  return map;
}
