import fs from "node:fs";
import path from "node:path";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { validateCatalogs } from "../validator/catalogs.js";
import {
  applySeverityOverrides,
  type ValidationResult,
  validateFeature,
} from "../validator/validate.js";
import {
  FEATURE_FILE_SUFFIX,
  findFeatureFiles,
  isWithinRoot,
  loadWorkspace,
  type Workspace,
} from "../workspace/loader.js";

/** CLI exit codes (documented contract). */
export const EXIT_OK = 0;
export const EXIT_VALIDATION = 1;
export const EXIT_USAGE = 2;

export interface FileTarget {
  /** Absolute file path. */
  path: string;
  /** Path as shown to the user (relative to cwd). */
  display: string;
}

export interface ResolveResult {
  targets: FileTarget[];
  diagnostics: Diagnostic[];
}

/** Expands file/directory arguments into a sorted list of feature files. */
export function resolveTargets(inputs: readonly string[], cwd: string): ResolveResult {
  const targets: FileTarget[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  const push = (absolute: string) => {
    if (seen.has(absolute)) return;
    seen.add(absolute);
    targets.push({ path: absolute, display: path.relative(cwd, absolute) || absolute });
  };

  for (const input of inputs) {
    const absolute = path.resolve(cwd, input);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      diagnostics.push(
        makeDiagnostic(CODES.FILE_ERROR, {
          message: `No such file or directory: ${input}`,
          file: input,
        }),
      );
      continue;
    }
    if (stat.isDirectory()) {
      const found = findFeatureFiles(absolute);
      if (found.length === 0) {
        diagnostics.push(
          makeDiagnostic(CODES.FILE_ERROR, {
            message: `No *${FEATURE_FILE_SUFFIX} files found in ${input}.`,
            file: input,
          }),
        );
      }
      for (const file of found) push(file);
    } else {
      push(absolute);
    }
  }

  return { targets, diagnostics };
}

export interface ValidatedTarget {
  target: FileTarget;
  result: ValidationResult;
  /** True when the file could not even be read or parsed as YAML. */
  fatal: boolean;
}

/**
 * Workspaces are cached per directory so catalogs parse once per run,
 * even when validating hundreds of feature files.
 */
export function makeWorkspaceCache(): (dir: string) => Workspace {
  const cache = new Map<string, Workspace>();
  return (dir) => {
    const key = path.resolve(dir);
    const existing = cache.get(key);
    if (existing) return existing;
    const workspace = loadWorkspace(key);
    // Cache under both the requested dir and the resolved root.
    cache.set(key, workspace);
    cache.set(workspace.root, workspace);
    return workspace;
  };
}

/** Validates one file against its surrounding workspace. */
export function validateTarget(
  target: FileTarget,
  workspaceFor: (dir: string) => Workspace,
): ValidatedTarget {
  let source: string;
  try {
    source = fs.readFileSync(target.path, "utf8");
  } catch (error) {
    return {
      target,
      fatal: true,
      result: {
        valid: false,
        diagnostics: [
          makeDiagnostic(CODES.FILE_ERROR, {
            message: `Cannot read file: ${(error as Error).message}`,
            file: target.display,
          }),
        ],
      },
    };
  }

  const workspace = workspaceFor(path.dirname(target.path));
  const result = validateFeature(source, {
    file: target.display,
    services: workspace.services,
    events: workspace.events,
    definitions: workspace.definitions,
    knownFlows: workspace.knownFlows,
    flowOutcomes: workspace.flowOutcomes,
    severityOverrides: workspace.config.diagnostics,
  });

  const fatal = result.diagnostics.some(
    (d) => d.code === CODES.YAML_PARSE_ERROR.code || d.code === CODES.FILE_ERROR.code,
  );
  return { target, result, fatal };
}

const workspaceDiagnosticsCache = new WeakMap<Workspace, Diagnostic[]>();

/**
 * Workspace-level findings: catalog parse problems plus OpenAPI/AsyncAPI
 * reference checks (LS108/LS109/LS403). Computed once per workspace and
 * subject to the same severity overrides as feature diagnostics.
 */
export function workspaceDiagnostics(workspace: Workspace): Diagnostic[] {
  const cached = workspaceDiagnosticsCache.get(workspace);
  if (cached !== undefined) return cached;
  const diagnostics = applySeverityOverrides(
    [...workspace.diagnostics, ...validateCatalogs(workspace)],
    workspace.config.diagnostics,
  );
  workspaceDiagnosticsCache.set(workspace, diagnostics);
  return diagnostics;
}

/**
 * Resolves the config-driven output directory, refusing paths that escape the
 * workspace root (LS005) — the same containment every config-referenced *read*
 * path gets. Without it, a checked-in config with
 * `output: { directory: ../../somewhere }` would make export/render/graph
 * write attacker-named files outside the repo. An explicit `--output` flag is
 * the user's own choice and is not routed through this check.
 */
export function resolveConfigOutputDir(
  workspace: Workspace,
): { dir: string } | { error: Diagnostic } {
  const configured = workspace.config.output.directory;
  const dir = path.resolve(workspace.root, configured);
  if (!isWithinRoot(workspace.root, dir)) {
    return {
      error: makeDiagnostic(CODES.UNSAFE_WORKSPACE_PATH, {
        message:
          `output.directory resolves outside the workspace root: ${configured}. ` +
          "Use a directory inside the workspace, or pass --output explicitly.",
        file: workspace.configPath,
        path: ["output", "directory"],
      }),
    };
  }
  return { dir };
}

/** Resolves the workspace for bare commands (no paths) from the cwd. */
export function requireWorkspace(
  cwd: string,
): { workspace: Workspace; featuresDir: string } | { error: Diagnostic } {
  const workspace = loadWorkspace(cwd);
  if (workspace.configPath === undefined) {
    return {
      error: makeDiagnostic(CODES.CONFIG_ERROR, {
        message: `No logicspec.config.yaml found from ${cwd} upward. Pass explicit paths or run "logicspec init".`,
      }),
    };
  }
  return {
    workspace,
    featuresDir: path.resolve(workspace.root, workspace.config.features.directory),
  };
}
