import type { FeatureGraph } from "./graph/edges.js";
import type { NormalizedFeature } from "./graph/normalize.js";
import { computeStats, type FeatureStats } from "./validator/stats.js";

/**
 * Stable, machine-readable summary of a feature. Field order and content are
 * part of the public contract — external tools and AI agents consume this.
 */
export interface InspectReport {
  feature: string;
  name: string;
  description?: string;
  start: string;
  actors: string[];
  context: string[];
  steps: Array<{ id: string; type: string; label: string; actor?: string }>;
  edges: Array<{ from: string; to: string; kind: string; label?: string }>;
  terminals: string[];
  finalOutcomes: string[];
  services: string[];
  operations: string[];
  events: string[];
  subflows: string[];
  stats: FeatureStats;
}

export function inspectFeature(feature: NormalizedFeature, graph: FeatureGraph): InspectReport {
  const operations: string[] = [];
  const events: string[] = [];
  const subflows: string[] = [];

  for (const step of feature.steps) {
    const def = step.def;
    if (def.type === "operation" && def.call !== undefined) operations.push(def.call);
    if (def.type === "page") {
      for (const load of def.load ?? []) operations.push(load.call);
    }
    if (def.type === "event") events.push(def.event);
    if (def.type === "subflow") subflows.push(def.flow);
    if (def.type === "parallel") {
      for (const branch of Object.values(def.branches)) subflows.push(branch.flow);
    }
  }

  const unique = (values: string[]) => [...new Set(values)];
  const services = unique(operations.map((call) => call.slice(0, call.indexOf("."))));
  const stats = computeStats(feature, graph);

  return {
    feature: feature.id,
    name: feature.name,
    description: feature.description,
    start: feature.start,
    actors: feature.actors.map((a) => a.id),
    context: feature.context.map((c) => c.name),
    steps: feature.steps.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      ...(s.actor !== undefined ? { actor: s.actor } : {}),
    })),
    edges: graph.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      ...(e.label !== undefined ? { label: e.label } : {}),
    })),
    terminals: graph.terminals,
    finalOutcomes: stats.finalOutcomes,
    services,
    operations: unique(operations),
    events: unique(events),
    subflows: unique(subflows),
    stats,
  };
}
