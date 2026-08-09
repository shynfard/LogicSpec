import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import type { StepType } from "../schema/feature.js";

export interface FeatureStats {
  steps: number;
  byType: Record<StepType, number>;
  transitions: number;
  actors: number;
  finalOutcomes: string[];
}

export function computeStats(feature: NormalizedFeature, graph: FeatureGraph): FeatureStats {
  const byType: Record<StepType, number> = {
    page: 0,
    decision: 0,
    operation: 0,
    event: 0,
    wait: 0,
    subflow: 0,
    parallel: 0,
    error: 0,
    final: 0,
  };
  const finalOutcomes: string[] = [];
  for (const step of feature.steps) {
    byType[step.type] += 1;
    if (step.def.type === "final") finalOutcomes.push(step.def.outcome);
  }
  return {
    steps: feature.steps.length,
    byType,
    transitions: graph.edges.length,
    actors: feature.actors.length,
    finalOutcomes,
  };
}
