import { z } from "zod";
import {
  actorKindSchema,
  callRefSchema,
  contextTypeSchema,
  durationSchema,
  type EventKind,
  eventKindSchema,
  extensionsSchema,
  type FinalOutcome,
  finalOutcomeSchema,
  identifierSchema,
  versionSchema,
} from "./common.js";

export type { EventKind, FinalOutcome };

// ── Shared step properties ───────────────────────────────────────────────────

const stepBase = {
  label: z.string().optional().describe("Display label. Defaults to the step id."),
  actor: identifierSchema.optional().describe("Actor responsible for this step."),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  extensions: extensionsSchema.optional(),
};

/** A transition outcome: `{ next: <step-id>, label?: ... }`. */
const outcomeSchema = z.strictObject({
  label: z.string().optional(),
  next: identifierSchema.describe("Target step id."),
});

/**
 * A transition outcome that may carry an optional descriptive guard. The
 * `when` predicate is documentation only — like decision `cases[].when`, it is
 * never evaluated. Used by operation and subflow named outcomes.
 */
const guardedOutcomeSchema = z.strictObject({
  label: z.string().optional(),
  when: z.string().optional().describe("Descriptive transition guard. Never evaluated."),
  next: identifierSchema.describe("Target step id."),
});

// ── page ─────────────────────────────────────────────────────────────────────

const pageActionSchema = z.strictObject({
  label: z.string().optional().describe("Display label. Defaults to the action id."),
  when: z.string().optional().describe("Descriptive transition guard. Never evaluated."),
  requires: z.array(identifierSchema).optional().describe("Context needed for this action."),
  produces: z.array(identifierSchema).optional().describe("Context produced by this action."),
  next: identifierSchema.describe("Target step id."),
});

const pageLoadSchema = z.strictObject({
  call: callRefSchema.describe("Operation used to load page data."),
  on: z
    .record(identifierSchema, identifierSchema)
    .optional()
    .describe("Maps load outcomes to LOCAL page states (not workflow steps)."),
});

export const pageStepSchema = z.strictObject({
  type: z.literal("page"),
  ...stepBase,
  route: z.string().optional().describe("Frontend route, e.g. /booking/checkout."),
  requires: z.array(identifierSchema).optional().describe("Context needed before entering."),
  states: z.array(identifierSchema).optional().describe("Local UI states (not workflow steps)."),
  load: z.array(pageLoadSchema).optional().describe("Background data loads for this page."),
  actions: z
    .record(identifierSchema, pageActionSchema)
    .optional()
    .describe("Things the user can do on this page."),
});

// ── decision ─────────────────────────────────────────────────────────────────

const decisionCaseSchema = z.strictObject({
  label: z.string().optional(),
  when: z.string().optional().describe("Descriptive condition. Never evaluated."),
  next: identifierSchema,
});

export const decisionStepSchema = z.strictObject({
  type: z.literal("decision"),
  ...stepBase,
  expression: z.string().optional().describe("Descriptive expression. Never evaluated."),
  cases: z.array(decisionCaseSchema).optional(),
  default: outcomeSchema.optional(),
});

// ── operation ────────────────────────────────────────────────────────────────

export const operationStepSchema = z.strictObject({
  type: z.literal("operation"),
  ...stepBase,
  call: callRefSchema.optional(),
  requires: z.array(identifierSchema).optional(),
  produces: z.array(identifierSchema).optional(),
  next: identifierSchema.optional().describe("Shorthand when there is a single outcome."),
  on: z
    .record(identifierSchema, guardedOutcomeSchema)
    .optional()
    .describe("Named outcomes, e.g. success / conflict / error."),
});

// ── event ────────────────────────────────────────────────────────────────────

export const eventStepSchema = z.strictObject({
  type: z.literal("event"),
  ...stepBase,
  direction: z.enum(["publish", "wait"]),
  eventKind: eventKindSchema
    .optional()
    .describe("Optional event classification (timer/message/signal/error/conditional)."),
  event: identifierSchema
    .optional()
    .describe("Event name for message/signal/generic events, resolved against the event catalog."),
  // Timer events (eventKind: timer) — exactly one of the following.
  after: durationSchema
    .optional()
    .describe("Timer relative delay, using the wait duration format (e.g. 15m)."),
  at: z.string().optional().describe("Timer absolute date/time. Descriptive, never evaluated."),
  every: durationSchema
    .optional()
    .describe("Timer recurring interval, using the wait duration format (e.g. 1d)."),
  // Error events (eventKind: error).
  name: z.string().optional().describe("Error event name/code. Descriptive, never evaluated."),
  // Conditional events (eventKind: conditional).
  when: z
    .string()
    .optional()
    .describe("Conditional event predicate. Descriptive, never evaluated."),
  next: identifierSchema.optional().describe("Used with direction: publish."),
  on: z
    .strictObject({
      received: outcomeSchema,
      timeout: outcomeSchema.optional(),
    })
    .optional()
    .describe("Used with direction: wait."),
  timeout: durationSchema.optional().describe("How long to wait before the timeout outcome."),
});

// ── wait ─────────────────────────────────────────────────────────────────────

export const waitStepSchema = z.strictObject({
  type: z.literal("wait"),
  ...stepBase,
  duration: durationSchema,
  next: identifierSchema,
});

// ── subflow ──────────────────────────────────────────────────────────────────

export const subflowStepSchema = z.strictObject({
  type: z.literal("subflow"),
  ...stepBase,
  flow: identifierSchema.describe("Feature id of another *.feature.yaml in the workspace."),
  requires: z.array(identifierSchema).optional(),
  produces: z.array(identifierSchema).optional(),
  next: identifierSchema.optional(),
  on: z.record(identifierSchema, guardedOutcomeSchema).optional(),
});

// ── parallel ─────────────────────────────────────────────────────────────────

const parallelBranchSchema = z.strictObject({
  flow: identifierSchema.describe("Feature id of the subflow this branch runs."),
});

export const parallelStepSchema = z.strictObject({
  type: z.literal("parallel"),
  ...stepBase,
  branches: z.record(identifierSchema, parallelBranchSchema),
  wait: z.enum(["all", "any"]).optional().describe('Join strategy. Defaults to "all".'),
  next: identifierSchema,
});

// ── error ────────────────────────────────────────────────────────────────────

const errorActionSchema = z.strictObject({
  label: z.string().optional(),
  next: identifierSchema,
});

export const errorStepSchema = z.strictObject({
  type: z.literal("error"),
  ...stepBase,
  message: z.string().optional(),
  actions: z
    .record(identifierSchema, errorActionSchema)
    .optional()
    .describe("Recovery actions. An error without actions is terminal."),
});

// ── final ────────────────────────────────────────────────────────────────────

export const finalStepSchema = z.strictObject({
  type: z.literal("final"),
  ...stepBase,
  outcome: finalOutcomeSchema,
  terminate: z
    .boolean()
    .optional()
    .describe("When true, ends the whole flow instance, not just this path. Defaults to false."),
});

/** Derived classification of a final step: normal | error | terminate. */
export type FinalKind = "normal" | "error" | "terminate";

/**
 * Classifies a final step. `terminate: true` wins (the instance stops);
 * otherwise a `failure` outcome reads as an error terminal; everything else is
 * a normal terminal. Derived, never stored — keeps the DSL additive.
 */
export function finalKind(step: { outcome: FinalOutcome; terminate?: boolean }): FinalKind {
  if (step.terminate === true) return "terminate";
  if (step.outcome === "failure") return "error";
  return "normal";
}

// ── Feature file ─────────────────────────────────────────────────────────────

export const stepSchema = z.discriminatedUnion("type", [
  pageStepSchema,
  decisionStepSchema,
  operationStepSchema,
  eventStepSchema,
  waitStepSchema,
  subflowStepSchema,
  parallelStepSchema,
  errorStepSchema,
  finalStepSchema,
]);

export const actorSchema = z.strictObject({
  kind: actorKindSchema,
  label: z.string().optional(),
  description: z.string().optional(),
});

export const contextVarSchema = z.strictObject({
  type: contextTypeSchema,
  description: z.string().optional(),
});

export const featureFileSchema = z.strictObject({
  version: versionSchema,
  feature: z.strictObject({
    id: identifierSchema,
    name: z.string(),
    description: z.string().optional(),
    extensions: extensionsSchema.optional(),
  }),
  start: identifierSchema.describe("Id of the first step."),
  actors: z.record(identifierSchema, actorSchema).optional(),
  context: z.record(identifierSchema, contextVarSchema).optional(),
  steps: z.record(identifierSchema, stepSchema),
  extensions: extensionsSchema.optional(),
});

export type PageAction = z.infer<typeof pageActionSchema>;
export type PageLoad = z.infer<typeof pageLoadSchema>;
export type PageStep = z.infer<typeof pageStepSchema>;
export type DecisionStep = z.infer<typeof decisionStepSchema>;
export type OperationStep = z.infer<typeof operationStepSchema>;
export type EventStep = z.infer<typeof eventStepSchema>;
export type WaitStep = z.infer<typeof waitStepSchema>;
export type SubflowStep = z.infer<typeof subflowStepSchema>;
export type ParallelStep = z.infer<typeof parallelStepSchema>;
export type ErrorStep = z.infer<typeof errorStepSchema>;
export type FinalStep = z.infer<typeof finalStepSchema>;
export type Step = z.infer<typeof stepSchema>;
export type StepType = Step["type"];
export type Actor = z.infer<typeof actorSchema>;
export type ContextVar = z.infer<typeof contextVarSchema>;
export type FeatureFile = z.infer<typeof featureFileSchema>;

export const STEP_TYPES: readonly StepType[] = [
  "page",
  "decision",
  "operation",
  "event",
  "wait",
  "subflow",
  "parallel",
  "error",
  "final",
];
