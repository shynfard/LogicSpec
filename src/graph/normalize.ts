import type { DocPath } from "../diagnostics/diagnostic.js";
import {
  type Actor,
  type ContextVar,
  DECISION_TABLE_TARGET_COLUMN,
  type DecisionTable,
  type FeatureFile,
  type Step,
  type StepType,
} from "../schema/feature.js";

/** How an edge came to exist. Renderers may style kinds differently. */
export type EdgeKind = "action" | "outcome" | "decision" | "event" | "default" | "next";

export interface NormalizedTransition {
  to: string;
  kind: EdgeKind;
  /** Display label, e.g. the action label or outcome name. */
  label?: string;
  /** Descriptive guard predicate for this transition. Never evaluated. */
  guard?: string;
  /** Document path of the `next` scalar, for diagnostics. */
  path: DocPath;
}

export interface NormalizedActor {
  id: string;
  kind: Actor["kind"];
  label: string;
  description?: string;
}

export interface NormalizedContextVar {
  name: string;
  type: ContextVar["type"];
  description?: string;
}

export interface NormalizedStep {
  id: string;
  type: StepType;
  /** Display label; falls back to the step id. */
  label: string;
  actor?: string;
  description?: string;
  tags: string[];
  notes?: string;
  /** The structurally validated step definition, exactly as authored. */
  def: Step;
  /** Every outgoing transition of this step, in source order. */
  transitions: NormalizedTransition[];
}

/**
 * The normalized feature model: the single representation that validators,
 * graph analysis and renderers consume. All transition discovery happens
 * here — nothing downstream re-interprets raw step shapes.
 */
export interface NormalizedFeature {
  version: "1";
  id: string;
  name: string;
  description?: string;
  start: string;
  actors: NormalizedActor[];
  context: NormalizedContextVar[];
  steps: NormalizedStep[];
}

/**
 * Builds a concise branch label for one decision-table rule from its
 * descriptive (non-target) output cells, e.g. `tier: gold`. Falls back to the
 * 1-based rule number when the rule has no descriptive outputs.
 */
function decisionRuleLabel(table: DecisionTable, then: string[], index: number): string {
  const parts: string[] = [];
  table.outputs.forEach((header, i) => {
    if (header === DECISION_TABLE_TARGET_COLUMN) return;
    const value = then[i];
    if (value !== undefined && value !== "" && value !== "-") {
      parts.push(`${header}: ${value}`);
    }
  });
  return parts.length > 0 ? parts.join(", ") : `rule ${index + 1}`;
}

function transitionsOf(id: string, step: Step): NormalizedTransition[] {
  const base: DocPath = ["steps", id];
  const transitions: NormalizedTransition[] = [];

  switch (step.type) {
    case "page": {
      for (const [actionId, action] of Object.entries(step.actions ?? {})) {
        transitions.push({
          to: action.next,
          kind: "action",
          label: action.label ?? actionId,
          guard: action.when,
          path: [...base, "actions", actionId, "next"],
        });
      }
      break;
    }
    case "decision": {
      (step.cases ?? []).forEach((c, index) => {
        transitions.push({
          to: c.next,
          kind: "decision",
          label: c.label ?? c.when,
          path: [...base, "cases", index, "next"],
        });
      });
      // A table-driven decision branches through its reserved `next` output
      // column: one transition per rule, targeting that rule's `next` cell.
      // These flow through the same machinery as cases, so unreachable/dangling
      // target checks (LS101/LS2xx) apply to table targets unchanged.
      const table = step.decisionTable;
      if (table !== undefined) {
        const nextColumn = table.outputs.indexOf(DECISION_TABLE_TARGET_COLUMN);
        if (nextColumn >= 0) {
          table.rules.forEach((rule, index) => {
            const to = rule.then[nextColumn];
            if (to === undefined) return; // malformed row width — LS307 covers it
            transitions.push({
              to,
              kind: "decision",
              label: decisionRuleLabel(table, rule.then, index),
              path: [...base, "decisionTable", "rules", index, "then", nextColumn],
            });
          });
        }
      }
      if (step.default) {
        transitions.push({
          to: step.default.next,
          kind: "default",
          label: step.default.label ?? "default",
          path: [...base, "default", "next"],
        });
      }
      break;
    }
    case "operation":
    case "subflow": {
      if (step.next !== undefined) {
        transitions.push({ to: step.next, kind: "next", path: [...base, "next"] });
      }
      for (const [outcome, target] of Object.entries(step.on ?? {})) {
        transitions.push({
          to: target.next,
          kind: "outcome",
          label: target.label ?? outcome,
          guard: target.when,
          path: [...base, "on", outcome, "next"],
        });
      }
      break;
    }
    case "event": {
      if (step.direction === "publish") {
        if (step.next !== undefined) {
          transitions.push({ to: step.next, kind: "next", path: [...base, "next"] });
        }
      } else if (step.on) {
        transitions.push({
          to: step.on.received.next,
          kind: "event",
          label: step.on.received.label ?? "received",
          path: [...base, "on", "received", "next"],
        });
        if (step.on.timeout) {
          transitions.push({
            to: step.on.timeout.next,
            kind: "event",
            label: step.on.timeout.label ?? (step.timeout ? `timeout ${step.timeout}` : "timeout"),
            path: [...base, "on", "timeout", "next"],
          });
        }
      }
      break;
    }
    case "wait": {
      transitions.push({
        to: step.next,
        kind: "next",
        label: `after ${step.duration}`,
        path: [...base, "next"],
      });
      break;
    }
    case "parallel": {
      transitions.push({ to: step.next, kind: "next", path: [...base, "next"] });
      break;
    }
    case "error": {
      for (const [actionId, action] of Object.entries(step.actions ?? {})) {
        transitions.push({
          to: action.next,
          kind: "action",
          label: action.label ?? actionId,
          path: [...base, "actions", actionId, "next"],
        });
      }
      break;
    }
    case "final":
      break;
  }

  return transitions;
}

/**
 * Converts a structurally valid feature file into the normalized model.
 * Source order of steps, actors and context variables is preserved so that
 * rendering stays deterministic and diff-friendly.
 */
export function normalizeFeature(feature: FeatureFile): NormalizedFeature {
  const actors: NormalizedActor[] = Object.entries(feature.actors ?? {}).map(([id, actor]) => ({
    id,
    kind: actor.kind,
    label: actor.label ?? id,
    description: actor.description,
  }));

  const context: NormalizedContextVar[] = Object.entries(feature.context ?? {}).map(
    ([name, v]) => ({ name, type: v.type, description: v.description }),
  );

  const steps: NormalizedStep[] = Object.entries(feature.steps).map(([id, step]) => ({
    id,
    type: step.type,
    label: step.label ?? id,
    actor: step.actor,
    description: step.description,
    tags: step.tags ?? [],
    notes: step.notes,
    def: step,
    transitions: transitionsOf(id, step),
  }));

  return {
    version: feature.version,
    id: feature.feature.id,
    name: feature.feature.name,
    description: feature.feature.description,
    start: feature.start,
    actors,
    context,
    steps,
  };
}
