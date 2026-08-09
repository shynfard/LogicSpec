import { hasErrors } from "../diagnostics/diagnostic.js";
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
  makeWorkspaceCache,
  resolveTargets,
  validateTarget,
} from "./shared.js";

export interface ValidateCommandOptions {
  strict?: boolean;
  cwd?: string;
  io?: Io;
}

/** `logicspec validate <paths...>` */
export function runValidate(
  paths: readonly string[],
  options: ValidateCommandOptions = {},
): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();

  const { targets, diagnostics: resolveDiagnostics } = resolveTargets(paths, cwd);
  if (resolveDiagnostics.length > 0) {
    printDiagnostics(resolveDiagnostics, io);
    return EXIT_USAGE;
  }

  const workspaceFor = makeWorkspaceCache();
  let sawFatal = false;
  let sawError = false;
  let sawWarning = false;

  for (const target of targets) {
    const { result, fatal } = validateTarget(target, workspaceFor);
    printDiagnostics(result.diagnostics, io);

    if (fatal) sawFatal = true;
    if (hasErrors(result.diagnostics)) sawError = true;
    if (result.diagnostics.some((d) => d.severity === "warning")) sawWarning = true;

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

  if (sawFatal) return EXIT_USAGE;
  if (sawError) return EXIT_VALIDATION;
  if (options.strict === true && sawWarning) return EXIT_VALIDATION;
  return EXIT_OK;
}
