import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, type DocPath, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { suggest, withSuggestion } from "../diagnostics/suggest.js";
import { analyzeDataflow } from "../graph/dataflow.js";
import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature, NormalizedStep } from "../graph/normalize.js";
import {
  closure,
  componentHasCycle,
  forwardAdjacency,
  reverseAdjacency,
  stronglyConnectedComponents,
} from "../graph/reachability.js";
import type { PathLocator } from "../parser/yaml.js";
import type { EventsFile } from "../schema/events.js";
import { detailRefs } from "../schema/feature.js";
import type { ServicesFile } from "../schema/services.js";

/** Cross-reference context. Absent catalogs simply skip the matching checks. */
export interface SemanticContext {
  file?: string;
  services?: ServicesFile;
  events?: EventsFile;
  /** Feature ids (and file stems) resolvable as subflows. Undefined = no workspace, skip. */
  knownFlows?: ReadonlySet<string>;
  /** Final outcomes per resolvable flow, for subflow contract checking. */
  flowOutcomes?: ReadonlyMap<string, ReadonlySet<string>>;
  locate?: PathLocator;
}

const noLocation: PathLocator = () => undefined;

/**
 * Graph-aware and cross-reference validation of a normalized feature.
 * Assumes the input already passed structural validation.
 */
export function validateSemantics(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  context: SemanticContext = {},
): Diagnostic[] {
  const { file, services, events, knownFlows } = context;
  const locate = context.locate ?? noLocation;
  const diagnostics: Diagnostic[] = [];
  const stepIds = new Set(feature.steps.map((s) => s.id));
  const actorIds = new Set(feature.actors.map((a) => a.id));
  const contextNames = new Set(feature.context.map((c) => c.name));

  const report = (
    code: (typeof CODES)[keyof typeof CODES],
    message: string,
    path: DocPath,
    suggestion?: string,
  ) => {
    diagnostics.push(
      makeDiagnostic(code, {
        message: withSuggestion(message, suggestion),
        file,
        path,
        location: locate(path),
        suggestion,
      }),
    );
  };

  // ── Start step ─────────────────────────────────────────────────────────────
  if (!stepIds.has(feature.start)) {
    report(
      CODES.UNKNOWN_START,
      `start points to unknown step "${feature.start}".`,
      ["start"],
      suggest(feature.start, stepIds),
    );
  }

  // ── Per-step reference checks ──────────────────────────────────────────────
  for (const step of feature.steps) {
    checkTransitionTargets(step, stepIds, report);
    checkActor(step, actorIds, report);
    checkContextReferences(step, contextNames, report);
    if (services) checkCalls(step, services, report);
    if (events) {
      checkEvent(step, events, report);
      checkBoundaryEvents(step, events, report);
    }
    if (knownFlows) checkFlows(step, knownFlows, report);
    if (context.flowOutcomes) checkSubflowOutcomes(step, context.flowOutcomes, report);
    checkPageStates(step, report);
  }

  // ── Graph analysis ─────────────────────────────────────────────────────────
  diagnostics.push(...analyzeGraph(feature, graph, context));

  // ── Data flow: every requirement produced on every path ────────────────────
  for (const issue of analyzeDataflow(feature)) {
    const path: DocPath =
      issue.via === "action" && issue.actionId !== undefined
        ? ["steps", issue.stepId, "actions", issue.actionId, "requires"]
        : ["steps", issue.stepId, "requires"];
    const sample =
      issue.samplePredecessor === undefined
        ? ""
        : ` (e.g. arriving from "${issue.samplePredecessor}")`;
    diagnostics.push(
      makeDiagnostic(CODES.CONTEXT_NOT_PRODUCED, {
        message: `"${issue.variable}" is required by "${issue.stepId}"${
          issue.actionId === undefined ? "" : ` action "${issue.actionId}"`
        } but is not produced on every path from start${sample}.`,
        file,
        path,
        location: locate(path),
      }),
    );
  }

  // ── Unused declarations ────────────────────────────────────────────────────
  diagnostics.push(...checkUnusedDeclarations(feature, context));

  // ── Advisory ───────────────────────────────────────────────────────────────
  const outcomes = new Set<string>();
  for (const s of feature.steps) {
    if (s.def.type === "final") outcomes.add(s.def.outcome);
  }
  const hasTerminalError = graph.terminals.some(
    (t) => feature.steps.find((s) => s.id === t)?.type === "error",
  );
  if (!outcomes.has("failure") && !hasTerminalError) {
    diagnostics.push(
      makeDiagnostic(CODES.NO_FAILURE_OUTCOME, {
        message: `Feature "${feature.id}" declares no failure outcome. Consider whether every path really ends in ${[...outcomes].join("/") || "nothing"}.`,
        file,
        path: ["steps"],
        location: locate(["steps"]),
      }),
    );
  }

  return diagnostics;
}

type Reporter = (
  code: (typeof CODES)[keyof typeof CODES],
  message: string,
  path: DocPath,
  suggestion?: string,
) => void;

function checkTransitionTargets(
  step: NormalizedStep,
  stepIds: Set<string>,
  report: Reporter,
): void {
  for (const transition of step.transitions) {
    if (!stepIds.has(transition.to)) {
      report(
        CODES.UNKNOWN_STEP,
        `Step "${step.id}" transitions to unknown step "${transition.to}".`,
        transition.path,
        suggest(transition.to, stepIds),
      );
    }
  }
}

function checkActor(step: NormalizedStep, actorIds: Set<string>, report: Reporter): void {
  if (step.actor !== undefined && !actorIds.has(step.actor)) {
    report(
      CODES.UNKNOWN_ACTOR,
      `Step "${step.id}" references unknown actor "${step.actor}".`,
      ["steps", step.id, "actor"],
      suggest(step.actor, actorIds),
    );
  }
}

function checkContextReferences(
  step: NormalizedStep,
  contextNames: Set<string>,
  report: Reporter,
): void {
  const checkList = (names: readonly string[] | undefined, path: DocPath) => {
    (names ?? []).forEach((name, index) => {
      if (!contextNames.has(name)) {
        report(
          CODES.UNKNOWN_CONTEXT,
          `Step "${step.id}" references unknown context variable "${name}".`,
          [...path, index],
          suggest(name, contextNames),
        );
      }
    });
  };

  const def = step.def;
  const base: DocPath = ["steps", step.id];
  switch (def.type) {
    case "page": {
      checkList(def.requires, [...base, "requires"]);
      for (const [actionId, action] of Object.entries(def.actions ?? {})) {
        checkList(action.requires, [...base, "actions", actionId, "requires"]);
        checkList(action.produces, [...base, "actions", actionId, "produces"]);
      }
      break;
    }
    case "operation":
    case "subflow": {
      checkList(def.requires, [...base, "requires"]);
      checkList(def.produces, [...base, "produces"]);
      break;
    }
    default:
      break;
  }
}

function checkCalls(step: NormalizedStep, services: ServicesFile, report: Reporter): void {
  const check = (call: string, path: DocPath) => {
    const dot = call.indexOf(".");
    const serviceId = call.slice(0, dot);
    const operationId = call.slice(dot + 1);
    const service = services.services[serviceId];
    if (!service) {
      report(
        CODES.UNKNOWN_OPERATION,
        `Step "${step.id}" calls unknown service "${serviceId}".`,
        path,
        suggest(serviceId, Object.keys(services.services)),
      );
      return;
    }
    if (!service.operations[operationId]) {
      const suggestion = suggest(operationId, Object.keys(service.operations));
      report(
        CODES.UNKNOWN_OPERATION,
        `Step "${step.id}" calls unknown operation "${operationId}" on service "${serviceId}".`,
        path,
        suggestion === undefined ? undefined : `${serviceId}.${suggestion}`,
      );
    }
  };

  const def = step.def;
  if (def.type === "operation" && def.call !== undefined) {
    check(def.call, ["steps", step.id, "call"]);
  }
  if (def.type === "page") {
    (def.load ?? []).forEach((load, index) => {
      check(load.call, ["steps", step.id, "load", index, "call"]);
    });
  }
}

function checkEvent(step: NormalizedStep, events: EventsFile, report: Reporter): void {
  const def = step.def;
  if (def.type !== "event") return;
  if (def.event === undefined) return; // timer/error/conditional events name no catalog event
  if (!events.events[def.event]) {
    report(
      CODES.UNKNOWN_EVENT,
      `Step "${step.id}" references unknown event "${def.event}".`,
      ["steps", step.id, "event"],
      suggest(def.event, Object.keys(events.events)),
    );
  }
}

/**
 * Catalog-checks message/signal boundary event names, mirroring `checkEvent` for
 * a normal event step (LS105). The boundary schema documents these `event` names
 * as "resolved against the event catalog", so an unknown name is an LS105 miss
 * with a nearest-name suggestion. Other kinds (timer/error/conditional) name no
 * catalog event, and a missing required `event` is LS308's job, not this one.
 */
function checkBoundaryEvents(step: NormalizedStep, events: EventsFile, report: Reporter): void {
  const boundary = step.def.boundary;
  if (boundary === undefined) return;
  boundary.forEach((handler, index) => {
    if (handler.eventKind !== "message" && handler.eventKind !== "signal") return;
    if (handler.event === undefined) return;
    if (!events.events[handler.event]) {
      report(
        CODES.UNKNOWN_EVENT,
        `Boundary ${index + 1} on step "${step.id}" references unknown event "${handler.event}".`,
        ["steps", step.id, "boundary", index, "event"],
        suggest(handler.event, Object.keys(events.events)),
      );
    }
  });
}

function checkFlows(step: NormalizedStep, knownFlows: ReadonlySet<string>, report: Reporter): void {
  const def = step.def;
  for (const [index, ref] of detailRefs(def).entries()) {
    if (!knownFlows.has(ref.flow)) {
      report(
        CODES.UNKNOWN_DETAIL_FLOW,
        `Step "${step.id}" lists unknown detail flow "${ref.flow}".`,
        ["steps", step.id, "details", index],
        suggest(ref.flow, knownFlows),
      );
    }
  }
  if (def.type === "subflow" && !knownFlows.has(def.flow)) {
    report(
      CODES.UNKNOWN_SUBFLOW,
      `Step "${step.id}" references unknown subflow "${def.flow}".`,
      ["steps", step.id, "flow"],
      suggest(def.flow, knownFlows),
    );
  }
  if (def.type === "parallel") {
    for (const [branchId, branch] of Object.entries(def.branches)) {
      if (!knownFlows.has(branch.flow)) {
        report(
          CODES.UNKNOWN_SUBFLOW,
          `Branch "${branchId}" of parallel "${step.id}" references unknown subflow "${branch.flow}".`,
          ["steps", step.id, "branches", branchId, "flow"],
          suggest(branch.flow, knownFlows),
        );
      }
    }
  }
}

function checkSubflowOutcomes(
  step: NormalizedStep,
  flowOutcomes: ReadonlyMap<string, ReadonlySet<string>>,
  report: Reporter,
): void {
  const def = step.def;
  if (def.type !== "subflow" || def.on === undefined) return;
  const outcomes = flowOutcomes.get(def.flow);
  if (outcomes === undefined || outcomes.size === 0) return; // unknown flow → LS106 covers it
  for (const outcomeKey of Object.keys(def.on)) {
    if (!outcomes.has(outcomeKey)) {
      report(
        CODES.SUBFLOW_OUTCOME_MISMATCH,
        `Subflow "${step.id}" handles outcome "${outcomeKey}" but feature "${def.flow}" only ends in: ${[...outcomes].join(", ")}.`,
        ["steps", step.id, "on", outcomeKey],
        suggest(outcomeKey, outcomes),
      );
    }
  }
}

function checkUnusedDeclarations(
  feature: NormalizedFeature,
  context: SemanticContext,
): Diagnostic[] {
  const locate = context.locate ?? noLocation;
  const diagnostics: Diagnostic[] = [];

  const usedContext = new Set<string>();
  const usedActors = new Set<string>();
  for (const step of feature.steps) {
    if (step.actor !== undefined) usedActors.add(step.actor);
    const def = step.def;
    const addAll = (names: readonly string[] | undefined) => {
      for (const name of names ?? []) usedContext.add(name);
    };
    if (def.type === "page") {
      addAll(def.requires);
      for (const action of Object.values(def.actions ?? {})) {
        addAll(action.requires);
        addAll(action.produces);
      }
    } else if (def.type === "operation" || def.type === "subflow") {
      addAll(def.requires);
      addAll(def.produces);
    }
  }

  for (const variable of feature.context) {
    if (!usedContext.has(variable.name)) {
      diagnostics.push(
        makeDiagnostic(CODES.UNUSED_CONTEXT, {
          message: `Context variable "${variable.name}" is declared but never required or produced.`,
          file: context.file,
          path: ["context", variable.name],
          location: locate(["context", variable.name]),
        }),
      );
    }
  }
  for (const actor of feature.actors) {
    if (!usedActors.has(actor.id)) {
      diagnostics.push(
        makeDiagnostic(CODES.UNUSED_ACTOR, {
          message: `Actor "${actor.id}" is declared but never assigned to a step.`,
          file: context.file,
          path: ["actors", actor.id],
          location: locate(["actors", actor.id]),
        }),
      );
    }
  }

  return diagnostics;
}

function checkPageStates(step: NormalizedStep, report: Reporter): void {
  const def = step.def;
  if (def.type !== "page" || def.states === undefined || def.load === undefined) return;
  const states = new Set(def.states);
  def.load.forEach((load, index) => {
    for (const [outcome, state] of Object.entries(load.on ?? {})) {
      if (!states.has(state)) {
        report(
          CODES.UNKNOWN_STATE,
          `Page "${step.id}" load outcome "${outcome}" targets undeclared state "${state}".`,
          ["steps", step.id, "load", index, "on", outcome],
          suggest(state, states),
        );
      }
    }
  });
}

function analyzeGraph(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  context: SemanticContext,
): Diagnostic[] {
  const { file } = context;
  const locate = context.locate ?? noLocation;
  const diagnostics: Diagnostic[] = [];

  const forward = forwardAdjacency(graph);
  const reverse = reverseAdjacency(graph);
  const reachable = closure([graph.start], forward);
  const canFinish = closure(graph.terminals, reverse);

  // Unreachable steps.
  for (const step of feature.steps) {
    if (!reachable.has(step.id)) {
      diagnostics.push(
        makeDiagnostic(CODES.UNREACHABLE_STEP, {
          message: `Step "${step.id}" cannot be reached from start ("${feature.start}").`,
          file,
          path: ["steps", step.id],
          location: locate(["steps", step.id]),
        }),
      );
    }
  }

  // Dead ends: non-terminal steps with no outgoing transitions.
  for (const step of feature.steps) {
    if (step.type === "final" || step.type === "error") continue;
    if (step.type === "decision") continue; // empty decisions are LS303
    if (step.transitions.length === 0) {
      diagnostics.push(
        makeDiagnostic(CODES.DEAD_END, {
          message: `${describeStep(step)} has no outgoing transition. Add "next"/"on"${step.type === "page" ? " via an action" : ""} or make the flow end in a final step.`,
          file,
          path: ["steps", step.id],
          location: locate(["steps", step.id]),
        }),
      );
    }
  }

  // Closed loops: cycles reachable from start with no path to any terminal.
  // Legitimate retry loops always have an exit, so they never trigger this.
  for (const component of stronglyConnectedComponents(graph)) {
    if (!componentHasCycle(component, graph)) continue;
    const inFlow = component.some((id) => reachable.has(id));
    const escapes = component.some((id) => canFinish.has(id));
    if (inFlow && !escapes) {
      const members = [...component].sort();
      const anchor = members[0] as string;
      diagnostics.push(
        makeDiagnostic(CODES.CLOSED_LOOP, {
          message: `Steps ${members.map((m) => `"${m}"`).join(" → ")} form a loop with no path to any final outcome.`,
          file,
          path: ["steps", anchor],
          location: locate(["steps", anchor]),
        }),
      );
    }
  }

  return diagnostics;
}

function describeStep(step: NormalizedStep): string {
  return `${step.type[0]?.toUpperCase()}${step.type.slice(1)} "${step.id}"`;
}
