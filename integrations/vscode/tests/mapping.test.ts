import { describe, expect, it } from "vitest";
import type { Diagnostic } from "logicspec";
import { mapDiagnostic, mapRange, mapSeverity } from "../src/mapping.js";

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    code: "LS101",
    name: "UNKNOWN_STEP",
    severity: "error",
    message: 'Step "a" transitions to unknown step "b".',
    ...overrides,
  };
}

describe("mapSeverity", () => {
  it("maps to vscode DiagnosticSeverity numbers", () => {
    expect(mapSeverity("error")).toBe(0);
    expect(mapSeverity("warning")).toBe(1);
    expect(mapSeverity("info")).toBe(2);
  });
});

describe("mapRange", () => {
  it("falls back to the first character when no location exists", () => {
    expect(mapRange(diagnostic({}))).toEqual({
      startLine: 0,
      startCharacter: 0,
      endLine: 0,
      endCharacter: 1,
    });
  });

  it("converts 1-based start positions to 0-based single-character ranges", () => {
    expect(mapRange(diagnostic({ location: { line: 12, column: 5 } }))).toEqual({
      startLine: 11,
      startCharacter: 4,
      endLine: 11,
      endCharacter: 5,
    });
  });

  it("uses endLine/endColumn when the core provides them", () => {
    const location = { line: 3, column: 5, endLine: 3, endColumn: 14 } as Diagnostic["location"];
    expect(mapRange(diagnostic({ location }))).toEqual({
      startLine: 2,
      startCharacter: 4,
      endLine: 2,
      endCharacter: 13,
    });
  });

  it("never produces an empty range on the same line", () => {
    const location = { line: 3, column: 5, endLine: 3, endColumn: 5 } as Diagnostic["location"];
    const range = mapRange(diagnostic({ location }));
    expect(range.endCharacter).toBeGreaterThan(range.startCharacter);
  });
});

describe("mapDiagnostic", () => {
  it("appends a suggestion when the message lacks one", () => {
    const mapped = mapDiagnostic(
      diagnostic({ message: 'Unknown step "chekout".', suggestion: "checkout" }),
    );
    expect(mapped.message).toBe('Unknown step "chekout". Did you mean "checkout"?');
  });

  it("does not duplicate an existing suggestion", () => {
    const mapped = mapDiagnostic(
      diagnostic({
        message: 'Unknown step "chekout". Did you mean "checkout"?',
        suggestion: "checkout",
      }),
    );
    expect(mapped.message.match(/Did you mean/g)).toHaveLength(1);
  });

  it("carries code and source", () => {
    const mapped = mapDiagnostic(diagnostic({}));
    expect(mapped.code).toBe("LS101");
    expect(mapped.source).toBe("logicspec");
  });
});
