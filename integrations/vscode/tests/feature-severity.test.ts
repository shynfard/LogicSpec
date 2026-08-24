import { describe, expect, it } from "vitest";
import { severityFor } from "../src/feature-severity.js";
import type { MappedDiagnostic } from "../src/mapping.js";

function diagnostic(severity: MappedDiagnostic["severity"]): MappedDiagnostic {
  return {
    code: "LS101",
    source: "logicspec",
    message: "x",
    severity,
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1 },
  };
}

describe("severityFor", () => {
  it("is 'valid' with no diagnostics", () => {
    expect(severityFor([])).toBe("valid");
  });

  it("is 'warning' when the worst diagnostic is a warning", () => {
    expect(severityFor([diagnostic(2), diagnostic(1)])).toBe("warning");
  });

  it("is 'error' when any diagnostic is an error, regardless of order", () => {
    expect(severityFor([diagnostic(1), diagnostic(0), diagnostic(2)])).toBe("error");
  });
});
