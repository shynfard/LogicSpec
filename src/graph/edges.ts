import type { EventKind, HitPolicy, StepType } from "../schema/feature.js";
import type { EdgeKind, NormalizedFeature } from "./normalize.js";

/** Decision-table summary exposed on a decision node for renderers and tools. */
export interface GraphDecisionTable {
  hitPolicy: HitPolicy;
  inputs: string[];
  outputs: string[];
  ruleCount: number;
}

export interface GraphNode {
  id: string;
  type: StepType;
  label: string;
  actor?: string;
  /** Final outcome, present only on final steps. */
  outcome?: string;
  /** Event classification, present only on typed event steps. */
  eventKind?: EventKind;
  /** True for a final step that terminates the whole flow instance. */
  terminate?: boolean;
  /** Present only on decision steps driven by a decision table. */
  decisionTable?: GraphDecisionTable;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
  /** Descriptive guard predicate for this edge. Never evaluated. */
  guard?: string;
}

/**
 * The explicit graph every analysis and renderer works from.
 * Nodes and edges preserve source order.
 */
export interface FeatureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  start: string;
  /** Steps where the flow ends: finals plus errors without recovery actions. */
  terminals: string[];
}

/** True when the step type is allowed to have no outgoing transitions. */
export function isTerminalStep(type: StepType, transitionCount: number): boolean {
  if (type === "final") return true;
  if (type === "error") return transitionCount === 0;
  return false;
}

export function buildGraph(feature: NormalizedFeature): FeatureGraph {
  const nodes: GraphNode[] = feature.steps.map((step) => ({
    id: step.id,
    type: step.type,
    label: step.label,
    actor: step.actor,
    outcome: step.def.type === "final" ? step.def.outcome : undefined,
    eventKind: step.def.type === "event" ? step.def.eventKind : undefined,
    terminate: step.def.type === "final" ? step.def.terminate : undefined,
    decisionTable:
      step.def.type === "decision" && step.def.decisionTable !== undefined
        ? {
            hitPolicy: step.def.decisionTable.hitPolicy ?? "unique",
            inputs: step.def.decisionTable.inputs,
            outputs: step.def.decisionTable.outputs,
            ruleCount: step.def.decisionTable.rules.length,
          }
        : undefined,
  }));

  const edges: GraphEdge[] = feature.steps.flatMap((step) =>
    step.transitions.map((t) => ({
      from: step.id,
      to: t.to,
      kind: t.kind,
      label: t.label,
      guard: t.guard,
    })),
  );

  const terminals = feature.steps
    .filter((step) => isTerminalStep(step.type, step.transitions.length))
    .map((step) => step.id);

  return { nodes, edges, start: feature.start, terminals };
}
