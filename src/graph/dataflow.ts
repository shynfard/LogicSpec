import type { NormalizedFeature, NormalizedStep } from "./normalize.js";

/**
 * Must-availability analysis for context variables.
 *
 * A variable is "available" at a step only when it is produced on EVERY
 * path from start to that step (classic forward must-dataflow with set
 * intersection at joins). Reports are therefore genuine spec smells, never
 * layout-dependent guesses.
 *
 * Approximation, documented in docs/validation.md: `produces` of an
 * operation/subflow applies to all of its outcomes, including error paths.
 * This can only hide findings (false negatives), never invent them.
 */

export interface DataflowIssue {
  stepId: string;
  /** Variable that is required but not guaranteed to be produced. */
  variable: string;
  /** Where the requirement was declared. */
  via: "step" | "action";
  actionId?: string;
  /** One predecessor step on which the variable is missing, when known. */
  samplePredecessor?: string;
}

interface StepFlow {
  step: NormalizedStep;
  /** Variables this step itself produces on completion (operation/subflow). */
  produces: readonly string[];
  /** Extra produces per outgoing transition index (page/error action produces). */
  edgeProduces: ReadonlyArray<readonly string[]>;
}

function flowOf(step: NormalizedStep): StepFlow {
  const def = step.def;
  let produces: readonly string[] = [];
  if (def.type === "operation" || def.type === "subflow") {
    produces = def.produces ?? [];
  }
  const edgeProduces: string[][] = step.transitions.map(() => []);
  if (def.type === "page") {
    const actions = Object.values(def.actions ?? {});
    actions.forEach((action, index) => {
      edgeProduces[index] = action.produces ?? [];
    });
  }
  return { step, produces, edgeProduces };
}

/**
 * Computes must-available variable sets per step and returns every
 * requirement that is not satisfied on all paths. Unreachable steps are
 * never reported (their availability is unknowable).
 */
export function analyzeDataflow(feature: NormalizedFeature): DataflowIssue[] {
  const universe = feature.context.map((c) => c.name);
  if (universe.length === 0) return [];

  const flows = new Map<string, StepFlow>(feature.steps.map((s) => [s.id, flowOf(s)]));

  // Incoming edges per step: [fromId, availableAfterEdge(fromAvail) -> Set]
  interface Incoming {
    from: string;
    gen: readonly string[];
  }
  const incoming = new Map<string, Incoming[]>();
  for (const step of feature.steps) incoming.set(step.id, []);
  for (const step of feature.steps) {
    const flow = flows.get(step.id) as StepFlow;
    step.transitions.forEach((t, index) => {
      incoming.get(t.to)?.push({ from: step.id, gen: flow.edgeProduces[index] ?? [] });
    });
  }

  // IN[start] = ∅; everything else starts at ⊤ (the full universe) and only
  // shrinks. Iterate to fixpoint; monotone on a finite lattice, terminates.
  const top = new Set(universe);
  const inSets = new Map<string, Set<string>>();
  for (const step of feature.steps) {
    inSets.set(step.id, step.id === feature.start ? new Set() : new Set(top));
  }

  const outOf = (fromId: string): Set<string> => {
    const flow = flows.get(fromId) as StepFlow;
    const result = new Set(inSets.get(fromId));
    for (const name of flow.produces) result.add(name);
    return result;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const step of feature.steps) {
      if (step.id === feature.start) continue;
      const edges = incoming.get(step.id) ?? [];
      if (edges.length === 0) continue; // unreachable or entry-only; stays ⊤
      let merged: Set<string> | undefined;
      for (const edge of edges) {
        const avail = outOf(edge.from);
        for (const name of edge.gen) avail.add(name);
        if (merged === undefined) {
          merged = avail;
        } else {
          for (const name of merged) {
            if (!avail.has(name)) merged.delete(name);
          }
        }
      }
      const current = inSets.get(step.id) as Set<string>;
      const next = merged as Set<string>;
      if (next.size !== current.size || [...next].some((n) => !current.has(n))) {
        inSets.set(step.id, next);
        changed = true;
      }
    }
  }

  // Only report for steps reachable from start.
  const reachable = new Set<string>([feature.start]);
  const queue = [feature.start];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const flow = flows.get(id);
    if (!flow) continue;
    for (const t of flow.step.transitions) {
      if (flows.has(t.to) && !reachable.has(t.to)) {
        reachable.add(t.to);
        queue.push(t.to);
      }
    }
  }

  const issues: DataflowIssue[] = [];
  const missingFrom = (stepId: string, variable: string): string | undefined => {
    for (const edge of incoming.get(stepId) ?? []) {
      if (!reachable.has(edge.from)) continue;
      const avail = outOf(edge.from);
      for (const name of edge.gen) avail.add(name);
      if (!avail.has(variable)) return edge.from;
    }
    return undefined;
  };

  for (const step of feature.steps) {
    if (!reachable.has(step.id)) continue;
    const available = inSets.get(step.id) as Set<string>;
    const declared = new Set(universe);

    const check = (
      names: readonly string[] | undefined,
      via: "step" | "action",
      actionId?: string,
    ) => {
      for (const variable of names ?? []) {
        // Unknown variables are LS103; only analyze declared ones here.
        if (!declared.has(variable)) continue;
        if (!available.has(variable)) {
          issues.push({
            stepId: step.id,
            variable,
            via,
            actionId,
            samplePredecessor: missingFrom(step.id, variable),
          });
        }
      }
    };

    const def = step.def;
    if (def.type === "page") {
      check(def.requires, "step");
      for (const [actionId, action] of Object.entries(def.actions ?? {})) {
        check(action.requires, "action", actionId);
      }
    } else if (def.type === "operation" || def.type === "subflow") {
      check(def.requires, "step");
    }
  }

  return issues;
}
