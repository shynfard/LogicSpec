import { z } from "zod";
import {
  type AgentZoneKind,
  actorKindSchema,
  agentZoneKindSchema,
  callRefSchema,
  contextTypeSchema,
  durationSchema,
  type EventKind,
  eventKindSchema,
  extensionsSchema,
  type FinalOutcome,
  finalOutcomeSchema,
  type HitPolicy,
  hitPolicySchema,
  identifierSchema,
  versionSchema,
} from "./common.js";

export type { AgentZoneKind, EventKind, FinalOutcome, HitPolicy };

// ── Boundary events ──────────────────────────────────────────────────────────

/**
 * A boundary event handler: a documented alternative path taken when a timer
 * fires, an error is caught, a message/signal arrives, or a condition becomes
 * true WHILE the step is still in progress. It fills the gap for step types
 * that cannot otherwise express mid-flight timeout / error / message handling —
 * `subflow` (a called sub-process running past its SLA or failing mid-flight),
 * `page` (a user step that times out or is interrupted) and `parallel` (a whole
 * concurrent region exceeding an SLA). It is deliberately NOT allowed on step
 * types that already carry outcome maps (operation/subflow `on:`, event
 * `on.timeout`) — LS308 rejects it there rather than add a second way to say
 * the same thing.
 *
 * Like wave-2 typed events, a boundary handler is DESCRIPTIVE, never evaluated
 * or scheduled: the tool never fires a timer or tests a condition. It reuses the
 * same `eventKind` classification and the same per-kind fields as a typed event;
 * per-kind consistency is enforced by LS308, mirroring the event LS305 rules.
 */

/**
 * Generous-but-safe upper bound on a step's `boundary` handler array. A boundary
 * is descriptive documentation, not a runtime, so this cap is far larger than any
 * hand-authored handler list yet small enough that a hostile document cannot make
 * validation quadratic: each handler contributes a transition, a graph edge and an
 * O(n·m) "did you mean" suggestion pass over the step set, so thousands of handlers
 * pointing at unresolved targets would otherwise hang the validator. Mirrors the
 * decision-table caps; exceeding it is LS308.
 */
export const MAX_BOUNDARY_HANDLERS = 1000;

/**
 * Max characters in any single descriptive boundary string field (`after`, `at`,
 * `every`, `name`, `when`, `label`, `event`, `next`). Mirrors the decision-table
 * cell-length cap; exceeding it is LS308.
 */
export const MAX_BOUNDARY_FIELD_LENGTH = 500;

/** Shared LS308 message for an over-long descriptive boundary field. */
const boundaryFieldTooLong = `has a boundary field longer than ${MAX_BOUNDARY_FIELD_LENGTH} characters; boundary fields are capped at ${MAX_BOUNDARY_FIELD_LENGTH}.`;

/** A descriptive boundary string, length-bounded to cap resource use. */
const boundedBoundaryField = z.string().max(MAX_BOUNDARY_FIELD_LENGTH, boundaryFieldTooLong);

export const boundaryHandlerSchema = z.strictObject({
  eventKind: eventKindSchema.describe(
    "Boundary trigger classification (timer/message/signal/error/conditional). Reuses the event eventKind.",
  ),
  interrupting: z
    .boolean()
    .optional()
    .describe(
      "When true (default), firing diverts the flow to `next`; when false, it spawns a parallel descriptive path. Both are descriptive — never fired.",
    ),
  // Timer boundary (eventKind: timer) — exactly one of the following.
  after: durationSchema
    .max(MAX_BOUNDARY_FIELD_LENGTH, boundaryFieldTooLong)
    .optional()
    .describe("Timer relative delay (e.g. 30d). Descriptive, never scheduled."),
  at: boundedBoundaryField
    .optional()
    .describe("Timer absolute date/time. Descriptive, never evaluated."),
  every: durationSchema
    .max(MAX_BOUNDARY_FIELD_LENGTH, boundaryFieldTooLong)
    .optional()
    .describe("Timer recurring cadence (e.g. 1d). Descriptive, never scheduled."),
  // Message / signal boundary (eventKind: message | signal).
  event: identifierSchema
    .max(MAX_BOUNDARY_FIELD_LENGTH, boundaryFieldTooLong)
    .optional()
    .describe("Event name for a message/signal boundary, resolved against the event catalog."),
  // Error boundary (eventKind: error).
  name: boundedBoundaryField.optional().describe("Error name/code. Descriptive, never evaluated."),
  // Conditional boundary (eventKind: conditional).
  when: boundedBoundaryField
    .optional()
    .describe("Conditional predicate. Descriptive, never evaluated."),
  label: boundedBoundaryField.optional().describe("Optional display label for the boundary edge."),
  next: identifierSchema
    .max(MAX_BOUNDARY_FIELD_LENGTH, boundaryFieldTooLong)
    .describe("Target step id the boundary diverts to."),
});

// ── Shared step properties ───────────────────────────────────────────────────

const stepBase = {
  label: z.string().optional().describe("Display label. Defaults to the step id."),
  actor: identifierSchema.optional().describe("Actor responsible for this step."),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  boundary: z
    .array(boundaryHandlerSchema)
    .max(
      MAX_BOUNDARY_HANDLERS,
      `declares more than ${MAX_BOUNDARY_HANDLERS} boundary handlers; a step is capped at ${MAX_BOUNDARY_HANDLERS} boundary handlers.`,
    )
    .optional()
    .describe(
      "Boundary event handlers: documented alternative paths when this step times out, errors, or receives a message/condition mid-flight. Allowed only on subflow, page and parallel steps (LS308).",
    ),
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

/**
 * The reserved output column that names the transition target. When a decision
 * table's `outputs` contains a column with this exact header, each rule's cell
 * in that column is the step id the decision moves to when the rule is picked.
 * Every other output column is a descriptive result value, never interpreted.
 */
export const DECISION_TABLE_TARGET_COLUMN = "next";

/**
 * Generous-but-safe upper bounds on a decision table. A decision table is
 * descriptive documentation, not a runtime rule engine, so these caps are far
 * larger than any hand-authored table yet small enough that a hostile document
 * cannot exhaust memory (a large grid inflates linearly through normalization,
 * graph building and the O(n·m) suggestion pass). Exceeding any bound is LS307.
 */
export const DECISION_TABLE_LIMITS = {
  /** Maximum number of rules (rows). */
  rules: 1000,
  /** Maximum number of input columns. */
  inputs: 50,
  /** Maximum number of output columns. */
  outputs: 50,
  /** Maximum characters in any single header or cell (including a `next` target). */
  cellLength: 500,
} as const;

/** Parity cap on free-form decision `cases`, mirroring the decision-table rule cap. */
export const MAX_DECISION_CASES = 1000;

/** A single header or cell string, length-bounded to cap resource use. */
const boundedCell = z
  .string()
  .max(
    DECISION_TABLE_LIMITS.cellLength,
    `has a cell longer than ${DECISION_TABLE_LIMITS.cellLength} characters; decision-table cells are capped at ${DECISION_TABLE_LIMITS.cellLength}.`,
  );

/**
 * One rule (row) of a decision table. Both arrays are positional: a `when` cell
 * per input column and a `then` cell per output column. Every cell is
 * descriptive text — like a decision `when`, nothing here is ever evaluated.
 */
const decisionRuleSchema = z.strictObject({
  when: z
    .array(boundedCell)
    .describe(
      'One predicate cell per input column, in order. "-" or "" means any. Never evaluated.',
    ),
  // biome-ignore lint/suspicious/noThenProperty: canonical DMN decision-table output field; a Zod schema object, not a thenable.
  then: z
    .array(boundedCell)
    .describe("One value cell per output column, in order. Never evaluated."),
});

/**
 * A DMN-style decision table: a grid of rules instead of free-form cases. It is
 * a description, not a runtime — the hit policy is a declarative label and no
 * cell is ever evaluated. A reserved `next` output column names the transition
 * target step; the remaining outputs are descriptive result values.
 */
const decisionTableSchema = z.strictObject({
  inputs: z
    .array(boundedCell)
    .max(
      DECISION_TABLE_LIMITS.inputs,
      `has more than ${DECISION_TABLE_LIMITS.inputs} input columns; decision tables are capped at ${DECISION_TABLE_LIMITS.inputs}.`,
    )
    .describe('Input column headers — the things being tested, e.g. ["age", "country"].'),
  outputs: z
    .array(boundedCell)
    .max(
      DECISION_TABLE_LIMITS.outputs,
      `has more than ${DECISION_TABLE_LIMITS.outputs} output columns; decision tables are capped at ${DECISION_TABLE_LIMITS.outputs}.`,
    )
    .describe(
      'Output column headers (at least one). A reserved "next" column names the target step; the rest are descriptive results, e.g. ["tier", "next"].',
    ),
  hitPolicy: hitPolicySchema
    .optional()
    .describe(
      'How matching rules combine. Declarative label, never evaluated. Defaults to "unique".',
    ),
  rules: z
    .array(decisionRuleSchema)
    .max(
      DECISION_TABLE_LIMITS.rules,
      `has more than ${DECISION_TABLE_LIMITS.rules} rules; decision tables are capped at ${DECISION_TABLE_LIMITS.rules}.`,
    )
    .describe("Rule rows. Each row has one when-cell per input and one then-cell per output."),
});

export const decisionStepSchema = z.strictObject({
  type: z.literal("decision"),
  ...stepBase,
  expression: z.string().optional().describe("Descriptive expression. Never evaluated."),
  cases: z
    .array(decisionCaseSchema)
    .max(MAX_DECISION_CASES, `a decision may not declare more than ${MAX_DECISION_CASES} cases.`)
    .optional(),
  decisionTable: decisionTableSchema
    .optional()
    .describe("A DMN-style decision table. Mutually exclusive with cases."),
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
    .describe(
      "Timer relative delay, using the wait duration format (e.g. 15m). Descriptive, never scheduled.",
    ),
  at: z.string().optional().describe("Timer absolute date/time. Descriptive, never evaluated."),
  every: durationSchema
    .optional()
    .describe(
      "Timer recurring cadence, using the wait duration format (e.g. 1d). Descriptive, never scheduled.",
    ),
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

// ── Agent zones ────────────────────────────────────────────────────────────

/**
 * An **agent zone** demarcates a REGION of an otherwise deterministic flow as
 * autonomous-agent territory: a stretch of steps an AI agent drives, where the
 * order is not fixed (Camunda's ad-hoc agent-zone pattern). It is purely
 * DESCRIPTIVE — a zone is an ANNOTATION. It does not change control flow, does
 * not execute, does not reorder, and produces no graph edges; it only records
 * which steps sit inside the agent's autonomous region so humans, diagrams and
 * MCP clients can see the boundary. Consistent with the rest of the DSL,
 * nothing here is ever run.
 */

/**
 * Generous-but-safe upper bounds on the zones construct. Zones are descriptive
 * annotations, not a runtime, so these caps sit far above any hand-authored
 * spec yet keep a hostile document from amplifying validation: every zone step
 * drives an O(steps) resolution + an O(n·m) "did you mean" suggestion pass, so
 * an unbounded `zones`/`steps` array would otherwise let a tiny document hang
 * the validator. Mirrors the wave-3/4 decision-table and boundary caps.
 * Exceeding any bound is LS309.
 */
export const AGENT_ZONE_LIMITS = {
  /** Maximum number of zones per feature. */
  zones: 100,
  /** Maximum number of member step ids per zone. */
  steps: 1000,
  /** Maximum characters in a zone label. */
  labelLength: 200,
  /** Maximum characters in a zone description. */
  descriptionLength: 1000,
} as const;

export const agentZoneSchema = z.strictObject({
  label: z
    .string()
    .max(
      AGENT_ZONE_LIMITS.labelLength,
      `has a zone label longer than ${AGENT_ZONE_LIMITS.labelLength} characters; zone labels are capped at ${AGENT_ZONE_LIMITS.labelLength}.`,
    )
    .describe('Display label for the agent zone, e.g. "AI Triage".'),
  description: z
    .string()
    .max(
      AGENT_ZONE_LIMITS.descriptionLength,
      `has a zone description longer than ${AGENT_ZONE_LIMITS.descriptionLength} characters; zone descriptions are capped at ${AGENT_ZONE_LIMITS.descriptionLength}.`,
    )
    .optional()
    .describe("Optional prose describing what the agent does in this region."),
  kind: agentZoneKindSchema
    .optional()
    .describe('Zone kind. Defaults to "agent" — the only kind for now.'),
  steps: z
    .array(identifierSchema)
    .max(
      AGENT_ZONE_LIMITS.steps,
      `declares more than ${AGENT_ZONE_LIMITS.steps} steps; a zone is capped at ${AGENT_ZONE_LIMITS.steps} steps.`,
    )
    .describe(
      "Step ids inside this agent's autonomous region. Each must resolve to a real step, and a step belongs to at most one zone (LS309).",
    ),
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
  zones: z
    .array(agentZoneSchema)
    .max(
      AGENT_ZONE_LIMITS.zones,
      `declares more than ${AGENT_ZONE_LIMITS.zones} agent zones; a feature is capped at ${AGENT_ZONE_LIMITS.zones} zones.`,
    )
    .optional()
    .describe(
      "Agent zones: named regions bounding autonomous, order-not-fixed AI-agent behavior. Descriptive annotation only — never executed or reordered.",
    ),
  extensions: extensionsSchema.optional(),
});

export type BoundaryHandler = z.infer<typeof boundaryHandlerSchema>;
export type PageAction = z.infer<typeof pageActionSchema>;
export type PageLoad = z.infer<typeof pageLoadSchema>;
export type PageStep = z.infer<typeof pageStepSchema>;
export type DecisionStep = z.infer<typeof decisionStepSchema>;
export type DecisionTable = z.infer<typeof decisionTableSchema>;
export type DecisionRule = z.infer<typeof decisionRuleSchema>;
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
export type AgentZone = z.infer<typeof agentZoneSchema>;
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

/**
 * Step types on which a `boundary` handler array is allowed (LS308). Boundary
 * events attach only to step types that cannot otherwise express a mid-flight
 * timeout / error / message divert: `page`, `subflow` and `parallel`. Operation
 * and waiting-event steps already carry outcome maps, so they are excluded to
 * avoid a second way to express the same handling.
 */
export const BOUNDARY_STEP_TYPES: readonly StepType[] = ["page", "subflow", "parallel"];
