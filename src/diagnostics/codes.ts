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

  // ── Advisory ──────────────────────────────────────────────────────────────
  NO_FAILURE_OUTCOME: code(
    "LS400",
    "NO_FAILURE_OUTCOME",
    "info",
    "The feature declares no failure outcome.",
  ),
} as const;

export type CodeKey = keyof typeof CODES;

/** All codes indexed by code string, e.g. "LS101". */
export const CODES_BY_ID: ReadonlyMap<string, DiagnosticCode> = new Map(
  Object.values(CODES).map((c) => [c.code, c]),
);
