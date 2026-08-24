import type { MappedDiagnostic } from "./mapping.js";

export type FeatureSeverity = "error" | "warning" | "valid";

/** Worst severity across a feature's diagnostics — pure, no vscode dependency. */
export function severityFor(diagnostics: readonly MappedDiagnostic[]): FeatureSeverity {
  if (diagnostics.some((d) => d.severity === 0)) return "error";
  if (diagnostics.some((d) => d.severity === 1)) return "warning";
  return "valid";
}
