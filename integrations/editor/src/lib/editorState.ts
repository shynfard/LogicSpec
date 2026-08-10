import type { Edge, Node } from "@xyflow/react";
import {
  validateFeature,
  type Diagnostic,
  type DocPath,
  type EdgeKind,
  type FeatureGraph,
  type NormalizedFeature,
  type NormalizedStep,
} from "logicspec/core";
import { layoutPositions, type Position } from "./layout";

export type StepFlowNode = Node<{ step: NormalizedStep }, "step">;
export type TransitionEdge = Edge<{ path: DocPath; kind: EdgeKind }>;

export interface Derived {
  feature?: NormalizedFeature;
  graph?: FeatureGraph;
  diagnostics: Diagnostic[];
  valid: boolean;
}

/** Runs the full validation pipeline over the current YAML text. */
export function derive(source: string): Derived {
  const result = validateFeature(source);
  return {
    feature: result.normalized,
    graph: result.graph,
    diagnostics: result.diagnostics,
    valid: result.valid,
  };
}

/**
 * Builds React Flow nodes and edges from the normalized model.
 * Edges are built from each step's transitions in source order, so (after
 * filtering transitions whose target step does not exist) they align with
 * buildGraph() edge order and each edge carries its document path for
 * two-way editing.
 */
export function toFlow(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  overrides?: ReadonlyMap<string, Position>,
): { nodes: StepFlowNode[]; edges: TransitionEdge[] } {
  const layout = layoutPositions(graph);
  const known = new Set(feature.steps.map((step) => step.id));

  const nodes: StepFlowNode[] = feature.steps.map((step) => ({
    id: step.id,
    type: "step",
    position: overrides?.get(step.id) ?? layout.get(step.id) ?? { x: 0, y: 0 },
    data: { step },
  }));

  const edges: TransitionEdge[] = [];
  for (const step of feature.steps) {
    step.transitions.forEach((transition, index) => {
      if (!known.has(transition.to)) return;
      edges.push({
        id: `e-${step.id}-${index}-${transition.to}`,
        source: step.id,
        target: transition.to,
        label: transition.label,
        animated: transition.kind === "event",
        data: { path: transition.path, kind: transition.kind },
      });
    });
  }

  return { nodes, edges };
}

/** First free id of the form `<base>-<n>` among the feature's steps. */
export function uniqueStepId(feature: NormalizedFeature | undefined, base: string): string {
  const existing = new Set(feature?.steps.map((step) => step.id) ?? []);
  let index = 1;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
