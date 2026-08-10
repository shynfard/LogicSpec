import type { Diagnostic } from "logicspec";

/**
 * Editor-neutral projection of a LogicSpec diagnostic. Everything here is
 * plain data so it can be unit-tested without importing the vscode module;
 * extension.ts converts these into vscode.Diagnostic instances.
 */
export interface MappedRange {
  /** 0-based. */
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** Matches vscode.DiagnosticSeverity: 0 = Error, 1 = Warning, 2 = Information. */
export type MappedSeverity = 0 | 1 | 2;

export interface MappedDiagnostic {
  code: string;
  source: "logicspec";
  message: string;
  severity: MappedSeverity;
  range: MappedRange;
}

export function mapSeverity(severity: Diagnostic["severity"]): MappedSeverity {
  switch (severity) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
  }
}

export function mapRange(diagnostic: Diagnostic): MappedRange {
  const location = diagnostic.location;
  if (location === undefined) {
    return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 };
  }
  const startLine = Math.max(0, location.line - 1);
  const startCharacter = Math.max(0, location.column - 1);
  // endLine/endColumn are optional on SourceLocation; older core versions
  // may omit them entirely, so access defensively.
  const extended = location as { endLine?: number; endColumn?: number };
  const endLine =
    extended.endLine !== undefined ? Math.max(startLine, extended.endLine - 1) : startLine;
  let endCharacter: number;
  if (extended.endColumn !== undefined) {
    endCharacter =
      endLine === startLine
        ? Math.max(startCharacter + 1, extended.endColumn - 1)
        : Math.max(0, extended.endColumn - 1);
  } else {
    endCharacter = startCharacter + 1;
  }
  return { startLine, startCharacter, endLine, endCharacter };
}

export function mapDiagnostic(diagnostic: Diagnostic): MappedDiagnostic {
  let message = diagnostic.message;
  if (diagnostic.suggestion !== undefined && !message.includes("Did you mean")) {
    message = `${message} Did you mean "${diagnostic.suggestion}"?`;
  }
  return {
    code: diagnostic.code,
    source: "logicspec",
    message,
    severity: mapSeverity(diagnostic.severity),
    range: mapRange(diagnostic),
  };
}
