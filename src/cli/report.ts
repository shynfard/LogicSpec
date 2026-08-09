import { countBySeverity, type Diagnostic, formatPath } from "../diagnostics/diagnostic.js";
import type { FeatureStats } from "../validator/stats.js";

/** Output sink so the CLI stays testable without capturing process streams. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export const processIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const useColor = (): boolean => process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(text: string, ansi: string): string {
  return useColor() ? `[${ansi}m${text}[0m` : text;
}

export const color = {
  red: (t: string) => paint(t, "31"),
  yellow: (t: string) => paint(t, "33"),
  green: (t: string) => paint(t, "32"),
  cyan: (t: string) => paint(t, "36"),
  dim: (t: string) => paint(t, "2"),
  bold: (t: string) => paint(t, "1"),
};

function severityTag(severity: Diagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return color.red("ERROR");
    case "warning":
      return color.yellow("WARNING");
    case "info":
      return color.cyan("INFO");
  }
}

/** Prints one diagnostic in the documented multi-line format. */
export function printDiagnostic(diagnostic: Diagnostic, io: Io): void {
  const sink = diagnostic.severity === "error" ? io.err : io.out;
  const position = diagnostic.location
    ? `:${diagnostic.location.line}:${diagnostic.location.column}`
    : "";
  sink(`${color.bold(diagnostic.code)} ${severityTag(diagnostic.severity)} ${diagnostic.name}`);
  if (diagnostic.file !== undefined) sink(`  file: ${diagnostic.file}${position}`);
  if (diagnostic.path !== undefined && diagnostic.path.length > 0) {
    sink(`  at:   ${formatPath(diagnostic.path)}`);
  }
  sink(`  ${diagnostic.message}`);
  sink("");
}

export function printDiagnostics(diagnostics: readonly Diagnostic[], io: Io): void {
  for (const diagnostic of diagnostics) printDiagnostic(diagnostic, io);
}

export function summarizeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const counts = countBySeverity(diagnostics);
  const parts = [
    `${counts.error} error${counts.error === 1 ? "" : "s"}`,
    `${counts.warning} warning${counts.warning === 1 ? "" : "s"}`,
  ];
  if (counts.info > 0) parts.push(`${counts.info} info`);
  return parts.join(", ");
}

export function printStats(name: string, stats: FeatureStats, io: Io): void {
  const rows: Array<[string, number]> = [
    ["Steps", stats.steps],
    ["Pages", stats.byType.page],
    ["Decisions", stats.byType.decision],
    ["Operations", stats.byType.operation],
    ["Events", stats.byType.event],
    ["Waits", stats.byType.wait],
    ["Subflows", stats.byType.subflow],
    ["Parallels", stats.byType.parallel],
    ["Errors", stats.byType.error],
    ["Finals", stats.byType.final],
    ["Transitions", stats.transitions],
    ["Actors", stats.actors],
  ];
  io.out(color.bold(name));
  for (const [label, value] of rows) {
    if (value === 0 && label !== "Steps" && label !== "Transitions") continue;
    io.out(`  ${`${label}:`.padEnd(13)}${value}`);
  }
  if (stats.finalOutcomes.length > 0) {
    io.out(`  ${"Outcomes:".padEnd(13)}${stats.finalOutcomes.join(", ")}`);
  }
  io.out("");
}
