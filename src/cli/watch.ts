import path from "node:path";
import { FEATURE_FILE_SUFFIX, featureDependents, loadWorkspace } from "../workspace/loader.js";
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
import { runRender } from "./render.js";
import { color, type Io, processIo } from "./report.js";
import { EXIT_OK } from "./shared.js";

export interface WatchCommandOptions {
  cwd?: string;
  io?: Io;
  /** Change-coalescing window in ms (default 150; 0 disables — for tests). */
  debounceMs?: number;
  /** Test seam: receives the watcher handle so callers can close it. */
  onWatching?: (watcher: { close: () => Promise<void> }) => void;
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

/**
 * `logicspec watch [dir]` — on every change: validate, print diagnostics,
 * and regenerate diagrams only when the source is valid. A previously valid
 * generated diagram is never overwritten by an invalid one because render
 * refuses to write for invalid specs.
 */
export function runWatch(dirArg: string | undefined, options: WatchCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const startDir = path.resolve(cwd, dirArg ?? ".");

  const workspace = loadWorkspace(startDir);
  const featuresDir =
    workspace.configPath !== undefined
      ? path.resolve(workspace.root, workspace.config.features.directory)
      : startDir;

  const renderAll = () => {
    io.out(`${color.dim(timestamp())} validating ${path.relative(cwd, featuresDir) || "."} …`);
    runRender([featuresDir], { cwd, io });
  };

  const renderChanged = (files: readonly string[]) => {
    for (const file of files) {
      io.out(`${color.dim(timestamp())} ${path.relative(cwd, file)} changed`);
    }
    // Reload the workspace ONCE for the whole burst so subflow dependents of
    // every changed feature are re-validated too (their contracts may have
    // changed).
    const current = loadWorkspace(startDir);
    const dependentsMap = featureDependents(current);
    const targets = new Set<string>(files);
    let dependentCount = 0;
    for (const file of files) {
      for (const dependent of dependentsMap.get(path.resolve(file)) ?? []) {
        if (!targets.has(dependent)) {
          targets.add(dependent);
          dependentCount += 1;
        }
      }
    }
    if (dependentCount > 0) {
      io.out(
        `${color.dim(timestamp())} also re-rendering ${dependentCount} dependent feature${dependentCount === 1 ? "" : "s"}`,
      );
    }
    runRender([...targets].sort(), { cwd, io });
  };

  io.out(`Watching ${path.relative(cwd, featuresDir) || "."} for changes. Ctrl+C to stop.`);
  renderAll();

  // Coalesce change bursts (a branch switch touches many files at once): the
  // pending set collects paths during the window, then one pass re-renders.
  // Without this, N changed features meant N full workspace reloads.
  const debounceMs = options.debounceMs ?? 150;
  const pendingFeatures = new Set<string>();
  let pendingAll = false;
  let flushTimer: NodeJS.Timeout | undefined;

  const flush = () => {
    flushTimer = undefined;
    const all = pendingAll;
    const files = [...pendingFeatures].sort();
    pendingAll = false;
    pendingFeatures.clear();
    if (all) renderAll();
    else if (files.length > 0) renderChanged(files);
  };

  const schedule = () => {
    if (debounceMs === 0) {
      flush();
      return;
    }
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, debounceMs);
  };

  const watcher = watchWorkspace(
    watchTargetsFor(workspace, startDir),
    (_event, file) => {
      if (file.endsWith(FEATURE_FILE_SUFFIX)) {
        pendingFeatures.add(file);
        schedule();
      } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        // Config or catalog changed: everything may be affected.
        pendingAll = true;
        schedule();
      }
    },
    (error) => io.err(`Watcher error: ${error.message}`),
  );
  options.onWatching?.(watcher);

  // chokidar keeps the process alive until the user interrupts.
  return EXIT_OK;
}
