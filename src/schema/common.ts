import { z } from "zod";

/** DSL document version. Breaking changes to semantics require a new version. */
export const versionSchema = z
  .literal("1")
  .describe('LogicSpec DSL version. Must be the string "1".');

/** Identifiers for steps, actors, actions, context variables, services, events. */
export const identifierSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*$/,
    "must start with a letter and contain only letters, digits, '-' or '_'",
  );

/** Operation reference: "<service>.<operation>". */
export const callRefSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z][A-Za-z0-9_-]*$/,
    'must have the form "<service>.<operation>", e.g. "booking.reserve-slot"',
  )
  .describe('Service operation reference, e.g. "booking.reserve-slot".');

/** Human-readable duration: "10m", "1h 30m", "500ms", "2d". */
export const durationSchema = z
  .string()
  .regex(
    /^\d+\s*(ms|s|m|h|d|w)(\s*\d+\s*(ms|s|m|h|d|w))*$/,
    'must be a duration such as "10m", "90s" or "1h 30m"',
  )
  .describe('Human-readable duration, e.g. "10m" or "1h 30m".');

export const contextTypeSchema = z
  .enum(["string", "number", "boolean", "object", "array", "date", "datetime"])
  .describe("Descriptive context variable type.");

/**
 * Namespaced extension data, e.g. { "company.example/foo": {...} }.
 * Keys must contain a "/" separating namespace from name. Core validation
 * preserves extension data and never interprets it.
 */
export const extensionsSchema = z
  .record(
    z
      .string()
      .regex(
        /^[^\s/]+\/[^\s/][^\s]*$/,
        'extension keys must be namespaced, e.g. "company.example/foo"',
      ),
    z.unknown(),
  )
  .describe("Namespaced extension metadata. Ignored by core validation.");

export const actorKindSchema = z
  .enum(["user", "frontend", "service", "broker", "external", "system", "agent"])
  .describe("What kind of participant this actor is. `agent` marks an autonomous AI agent actor.");

export const finalOutcomeSchema = z
  .enum(["success", "failure", "cancelled"])
  .describe("Outcome of a final step.");

/**
 * Optional classification of an event step, mirroring the common BPMN event
 * kinds. When absent the event keeps its generic publish/wait behavior.
 */
export const eventKindSchema = z
  .enum(["timer", "message", "signal", "error", "conditional"])
  .describe("Optional event classification. Absent keeps the generic event behavior.");

/**
 * DMN-standard decision-table hit policy. This is a declarative LABEL that
 * describes how matching rules combine — it is never an evaluator. Like every
 * predicate in the DSL, the table's cells are documentation, not runtime.
 */
export const hitPolicySchema = z
  .enum(["unique", "first", "priority", "any", "collect", "ruleOrder", "outputOrder"])
  .describe('DMN hit policy. A declarative label, never evaluated. Defaults to "unique".');

/**
 * The kind of an agent zone. Only `agent` exists today — a zone demarcates a
 * region of the flow that an autonomous AI agent drives, order-not-fixed. It is
 * an enum (not a bare literal) so future zone kinds stay additive.
 */
export const agentZoneKindSchema = z
  .enum(["agent"])
  .describe('Agent-zone kind. Only "agent" for now; the region is agent-driven.');

export type ContextType = z.infer<typeof contextTypeSchema>;
export type ActorKind = z.infer<typeof actorKindSchema>;
export type FinalOutcome = z.infer<typeof finalOutcomeSchema>;
export type EventKind = z.infer<typeof eventKindSchema>;
export type HitPolicy = z.infer<typeof hitPolicySchema>;
export type AgentZoneKind = z.infer<typeof agentZoneKindSchema>;
