/**
 * Stable diagnostic codes for LogicSpec.
 *
 * Codes are part of the public contract: tools, CI pipelines and AI agents
 * may match on them. Never renumber or reuse a code; deprecate instead.
 */
export type Severity = "error" | "warning" | "info";

export interface DiagnosticCode {
  readonly code: string;
  readonly name: string;
  readonly severity: Severity;
  readonly summary: string;
}

function code(c: string, name: string, severity: Severity, summary: string): DiagnosticCode {
  return { code: c, name, severity, summary };
}

export const CODES = {
  // ── File-level ────────────────────────────────────────────────────────────
  YAML_PARSE_ERROR: code("LS001", "YAML_PARSE_ERROR", "error", "The file is not valid YAML."),
  SCHEMA_ERROR: code("LS002", "SCHEMA_ERROR", "error", "The document does not match the schema."),
  CONFIG_ERROR: code("LS003", "CONFIG_ERROR", "error", "The workspace configuration is invalid."),
  FILE_ERROR: code("LS004", "FILE_ERROR", "error", "A file could not be read."),
  UNSAFE_WORKSPACE_PATH: code(
    "LS005",
    "UNSAFE_WORKSPACE_PATH",
    "error",
    "A config-referenced path resolves outside the workspace root.",
  ),

  // ── Reference resolution ──────────────────────────────────────────────────
  UNKNOWN_START: code("LS100", "UNKNOWN_START", "error", "start points to a nonexistent step."),
  UNKNOWN_STEP: code("LS101", "UNKNOWN_STEP", "error", "A transition targets a nonexistent step."),
  UNKNOWN_ACTOR: code("LS102", "UNKNOWN_ACTOR", "error", "A step references an undeclared actor."),
  UNKNOWN_CONTEXT: code(
    "LS103",
    "UNKNOWN_CONTEXT",
    "error",
    "requires/produces references an undeclared context variable.",
  ),
  UNKNOWN_OPERATION: code(
    "LS104",
    "UNKNOWN_OPERATION",
    "error",
    "call references a service or operation missing from the service catalog.",
  ),
  UNKNOWN_EVENT: code(
    "LS105",
    "UNKNOWN_EVENT",
    "error",
    "event references an event missing from the event catalog.",
  ),
  UNKNOWN_SUBFLOW: code(
    "LS106",
    "UNKNOWN_SUBFLOW",
    "error",
    "flow references a feature that does not exist in the workspace.",
  ),
  UNKNOWN_STATE: code(
    "LS107",
    "UNKNOWN_STATE",
    "error",
    "A page load outcome targets a state the page does not declare.",
  ),
  UNKNOWN_OPENAPI_OPERATION: code(
    "LS108",
    "UNKNOWN_OPENAPI_OPERATION",
    "error",
    "An openapi reference points to an operationId missing from the OpenAPI document.",
  ),
  UNKNOWN_ASYNCAPI_CHANNEL: code(
    "LS109",
    "UNKNOWN_ASYNCAPI_CHANNEL",
    "error",
    "An asyncapi reference points to a channel missing from the AsyncAPI document.",
  ),
  UNKNOWN_REF: code(
    "LS110",
    "UNKNOWN_REF",
    "error",
    "A $ref points to a shared definition that does not exist.",
  ),
  INVALID_REF: code(
    "LS111",
    "INVALID_REF",
    "error",
    "A $ref string is malformed or targets the wrong definition section.",
  ),
  REF_CYCLE: code(
    "LS112",
    "REF_CYCLE",
    "error",
    "Shared definitions reference each other in a cycle.",
  ),
  UNKNOWN_DETAIL_FLOW: code(
    "LS113",
    "UNKNOWN_DETAIL_FLOW",
    "warning",
    "A details entry references a flow that does not exist in the workspace.",
  ),

  // ── Graph analysis ────────────────────────────────────────────────────────
  UNREACHABLE_STEP: code(
    "LS200",
    "UNREACHABLE_STEP",
    "warning",
    "A step exists but cannot be reached from start.",
  ),
  DEAD_END: code("LS201", "DEAD_END", "error", "A non-terminal step has no outgoing transition."),
  CLOSED_LOOP: code(
    "LS202",
    "CLOSED_LOOP",
    "error",
    "A cycle has no path to any terminal outcome.",
  ),
  CONTEXT_NOT_PRODUCED: code(
    "LS203",
    "CONTEXT_NOT_PRODUCED",
    "warning",
    "A required context variable is not produced on every path from start.",
  ),

  // ── Step structure ────────────────────────────────────────────────────────
  INVALID_FINAL: code(
    "LS300",
    "INVALID_FINAL",
    "error",
    "A final step must not have outgoing transitions.",
  ),
  INVALID_TRANSITIONS: code(
    "LS301",
    "INVALID_TRANSITIONS",
    "error",
    "next and on are mutually exclusive on the same step.",
  ),
  INVALID_EVENT_STEP: code(
    "LS302",
    "INVALID_EVENT_STEP",
    "error",
    "The event step direction does not match its transition properties.",
  ),
  EMPTY_DECISION: code(
    "LS303",
    "EMPTY_DECISION",
    "error",
    "A decision must define at least one case or a default.",
  ),
  EMPTY_PARALLEL: code(
    "LS304",
    "EMPTY_PARALLEL",
    "error",
    "A parallel step must define at least one branch.",
  ),
  INVALID_EVENT_KIND: code(
    "LS305",
    "INVALID_EVENT_KIND",
    "error",
    "An event step's fields are inconsistent with its eventKind.",
  ),
  BLANK_GUARD: code(
    "LS306",
    "BLANK_GUARD",
    "error",
    "A descriptive when guard is present but blank.",
  ),
  INVALID_DECISION_TABLE: code(
    "LS307",
    "INVALID_DECISION_TABLE",
    "error",
    "A decision table's shape is inconsistent (row width, empty rules/outputs, or combined with cases).",
  ),
  INVALID_BOUNDARY: code(
    "LS308",
    "INVALID_BOUNDARY",
    "error",
    "A boundary event is on a disallowed step type, or its fields are inconsistent with its eventKind.",
  ),
  INVALID_ZONE: code(
    "LS309",
    "INVALID_ZONE",
    "error",
    "An agent zone references an unknown step, overlaps another zone, is empty, or exceeds its caps.",
  ),

  // ── Advisory ──────────────────────────────────────────────────────────────
  NO_FAILURE_OUTCOME: code(
    "LS400",
    "NO_FAILURE_OUTCOME",
    "info",
    "The feature declares no failure outcome.",
  ),
  UNUSED_CONTEXT: code(
    "LS401",
    "UNUSED_CONTEXT",
    "info",
    "A declared context variable is never required or produced.",
  ),
  UNUSED_ACTOR: code(
    "LS402",
    "UNUSED_ACTOR",
    "info",
    "A declared actor is never assigned to a step.",
  ),
  OPENAPI_MISMATCH: code(
    "LS403",
    "OPENAPI_MISMATCH",
    "warning",
    "The catalog operation's method or path disagrees with the OpenAPI document.",
  ),
  SUBFLOW_OUTCOME_MISMATCH: code(
    "LS404",
    "SUBFLOW_OUTCOME_MISMATCH",
    "warning",
    "A subflow outcome does not match any final outcome of the target feature.",
  ),
} as const;

export type CodeKey = keyof typeof CODES;

/** All codes indexed by code string, e.g. "LS101". */
export const CODES_BY_ID: ReadonlyMap<string, DiagnosticCode> = new Map(
  Object.values(CODES).map((c) => [c.code, c]),
);
