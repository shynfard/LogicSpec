import type { DiagnosticCode, Severity } from "./codes.js";

/** A path into the YAML document, e.g. ["steps", "reserve-slot", "on", "success", "next"]. */
export type DocPath = ReadonlyArray<string | number>;

export interface SourceLocation {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  /** 1-based end line of the node, when known (exclusive-ish: end of value). */
  endLine?: number;
  /** 1-based end column of the node, when known. */
  endColumn?: number;
}

/**
 * A single validation finding. Diagnostics are plain data: the library never
 * prints them, callers (CLI, editors, CI, agents) decide how to present them.
 */
export interface Diagnostic {
  /** Stable code, e.g. "LS101". */
  code: string;
  /** Stable name, e.g. "UNKNOWN_STEP". */
  name: string;
  severity: Severity;
  /** Human-readable, single-sentence problem statement. */
  message: string;
  /** File the diagnostic belongs to, when known. */
  file?: string;
  /** Path into the document, when known. */
  path?: DocPath;
  /** 1-based source position, when it could be resolved. */
  location?: SourceLocation;
  /** Nearest-name suggestion for typo-like errors, e.g. "checkout". */
  suggestion?: string;
}

export interface DiagnosticInput {
  message: string;
  file?: string;
  path?: DocPath;
  location?: SourceLocation;
  suggestion?: string;
  /** Override the default severity of the code (rarely needed). */
  severity?: Severity;
}

export function makeDiagnostic(code: DiagnosticCode, input: DiagnosticInput): Diagnostic {
  return {
    code: code.code,
    name: code.name,
    severity: input.severity ?? code.severity,
    message: input.message,
    file: input.file,
    path: input.path,
    location: input.location,
    suggestion: input.suggestion,
  };
}

export function formatPath(path: DocPath): string {
  return path.map((p) => String(p)).join(".");
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity] += 1;
  return counts;
}
