import { inspectFeature } from "../inspect.js";
import { color, type Io, printDiagnostics, processIo } from "./report.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION,
  makeWorkspaceCache,
  resolveTargets,
  validateTarget,
} from "./shared.js";

export interface InspectCommandOptions {
  json?: boolean;
  cwd?: string;
  io?: Io;
}

const TYPE_ORDER = [
  "page",
  "decision",
  "operation",
  "event",
  "wait",
  "subflow",
  "parallel",
  "error",
  "final",
] as const;

/** `logicspec inspect <file>` — human summary or stable JSON (--json). */
export function runInspect(paths: readonly string[], options: InspectCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();

  const { targets, diagnostics: resolveDiagnostics } = resolveTargets(paths, cwd);
  if (resolveDiagnostics.length > 0) {
    printDiagnostics(resolveDiagnostics, io);
    return EXIT_USAGE;
  }

  const workspaceFor = makeWorkspaceCache();
  const reports: unknown[] = [];
  let sawFatal = false;
  let sawError = false;

  for (const target of targets) {
    const { result, fatal } = validateTarget(target, workspaceFor);
    if (!result.normalized || !result.graph) {
      printDiagnostics(result.diagnostics, io);
      if (fatal) sawFatal = true;
      else sawError = true;
      continue;
    }

    const report = inspectFeature(result.normalized, result.graph);
    if (options.json === true) {
      reports.push(report);
      if (!result.valid) sawError = true;
      continue;
    }

    io.out(color.bold(`Feature: ${report.name} (${report.feature})`));
    io.out("");
    io.out(`Start\n  ${report.start}`);
    if (report.actors.length > 0) io.out(`\nActors\n${list(report.actors)}`);
    if (report.context.length > 0) io.out(`\nContext\n${list(report.context)}`);

    for (const type of TYPE_ORDER) {
      const ids = report.steps.filter((s) => s.type === type).map((s) => s.id);
      if (ids.length > 0) io.out(`\n${type[0]?.toUpperCase()}${type.slice(1)}s\n${list(ids)}`);
    }

    if (report.operations.length > 0) io.out(`\nOperations called\n${list(report.operations)}`);
    if (report.events.length > 0) io.out(`\nEvents referenced\n${list(report.events)}`);
    if (report.subflows.length > 0) io.out(`\nSubflows\n${list(report.subflows)}`);
    io.out(`\nFinal outcomes\n${list(report.finalOutcomes)}`);
    io.out(`\nTransitions: ${report.stats.transitions}`);
    if (!result.valid) {
      io.out("");
      printDiagnostics(result.diagnostics, io);
      sawError = true;
    }
    io.out("");
  }

  if (options.json === true && !sawFatal) {
    const payload = reports.length === 1 ? reports[0] : reports;
    io.out(JSON.stringify(payload, null, 2));
  }

  if (sawFatal) return EXIT_USAGE;
  if (sawError) return EXIT_VALIDATION;
  return EXIT_OK;
}

function list(items: readonly string[]): string {
  return items.map((item) => `  ${item}`).join("\n");
}
