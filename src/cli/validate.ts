import path from "node:path";
import { countBySeverity, type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import type { FeatureStats } from "../validator/stats.js";
import {
  color,
  type Io,
  printDiagnostics,
  printStats,
  processIo,
  summarizeDiagnostics,
} from "./report.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION,
  type FileTarget,
  makeWorkspaceCache,
  requireWorkspace,
  resolveTargets,
  validateTarget,
  workspaceDiagnostics,
} from "./shared.js";

export interface ValidateCommandOptions {
  strict?: boolean;
  json?: boolean;
  cwd?: string;
  io?: Io;
}

interface JsonFileReport {
  file: string;
  valid: boolean;
  diagnostics: Diagnostic[];
  stats?: FeatureStats;
}

/**
 * `logicspec validate [paths...]`
 * Without paths, validates the whole surrounding workspace.
 */
export function runValidate(
  paths: readonly string[],
  options: ValidateCommandOptions = {},
): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const json = options.json === true;

  let targets: FileTarget[];
  if (paths.length === 0) {
    const resolved = requireWorkspace(cwd);
    if ("error" in resolved) {
      printDiagnostics([resolved.error], io);
      return EXIT_USAGE;
    }
    const found = resolveTargets([resolved.featuresDir], cwd);
    if (found.diagnostics.length > 0) {
      printDiagnostics(found.diagnostics, io);
      return EXIT_USAGE;
    }
    targets = found.targets;
  } else {
    const found = resolveTargets(paths, cwd);
    if (found.diagnostics.length > 0) {
      printDiagnostics(found.diagnostics, io);
      return EXIT_USAGE;
    }
    targets = found.targets;
  }

  const workspaceFor = makeWorkspaceCache();
  const printedWorkspaces = new Set<string>();
  const workspaceFindings: Diagnostic[] = [];
  const reports: JsonFileReport[] = [];
  let sawFatal = false;
  let sawError = false;
  let sawWarning = false;

  for (const target of targets) {
    const workspace = workspaceFor(path.dirname(target.path));
    if (!printedWorkspaces.has(workspace.root)) {
      printedWorkspaces.add(workspace.root);
      const findings = workspaceDiagnostics(workspace);
      workspaceFindings.push(...findings);
      if (!json) printDiagnostics(findings, io);
      if (hasErrors(findings)) sawError = true;
      if (findings.some((d) => d.severity === "warning")) sawWarning = true;
    }

    const { result, fatal } = validateTarget(target, workspaceFor);

    if (fatal) sawFatal = true;
    if (hasErrors(result.diagnostics)) sawError = true;
    if (result.diagnostics.some((d) => d.severity === "warning")) sawWarning = true;

    if (json) {
      reports.push({
        file: target.display,
        valid: result.valid,
        diagnostics: result.diagnostics,
        stats: result.stats,
      });
      continue;
    }

    printDiagnostics(result.diagnostics, io);
    if (result.valid && result.normalized && result.stats) {
      printStats(`${result.normalized.name} (${target.display})`, result.stats, io);
      io.out(
        `${color.green("✓")} ${target.display} is valid (${summarizeDiagnostics(result.diagnostics)})`,
      );
    } else {
      io.err(
        `${color.red("✗")} ${target.display} is invalid (${summarizeDiagnostics(result.diagnostics)})`,
      );
    }
    io.out("");
  }

  if (json) {
    const all = [...workspaceFindings, ...reports.flatMap((r) => r.diagnostics)];
    const counts = countBySeverity(all);
    io.out(
      JSON.stringify(
        {
          valid: !sawError && !sawFatal && !(options.strict === true && sawWarning),
          files: reports,
          workspace: { diagnostics: workspaceFindings },
          summary: {
            files: reports.length,
            errors: counts.error,
            warnings: counts.warning,
            info: counts.info,
          },
        },
        null,
        2,
      ),
    );
  }

  if (sawFatal) return EXIT_USAGE;
  if (sawError) return EXIT_VALIDATION;
  if (options.strict === true && sawWarning) return EXIT_VALIDATION;
  return EXIT_OK;
}
