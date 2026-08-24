import path from "node:path";
import { FEATURE_FILE_SUFFIX, featureDependents, loadWorkspace } from "../workspace/loader.js";
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
import { runRender } from "./render.js";
import { color, type Io, processIo } from "./report.js";
import { EXIT_OK } from "./shared.js";

export interface WatchCommandOptions {
  cwd?: string;
  io?: Io;
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

  const renderChanged = (file: string) => {
    io.out(`${color.dim(timestamp())} ${path.relative(cwd, file)} changed`);
    // Reload the workspace so subflow dependents of the changed feature are
    // re-validated too (their contracts may have changed).
    const current = loadWorkspace(startDir);
    const dependents = featureDependents(current).get(path.resolve(file)) ?? new Set<string>();
    const targets = [file, ...[...dependents].sort()];
    if (dependents.size > 0) {
      io.out(
        `${color.dim(timestamp())} also re-rendering ${dependents.size} dependent feature${dependents.size === 1 ? "" : "s"}`,
      );
    }
    runRender(targets, { cwd, io });
  };

  io.out(`Watching ${path.relative(cwd, featuresDir) || "."} for changes. Ctrl+C to stop.`);
  renderAll();

  watchWorkspace(
    watchTargetsFor(workspace, startDir),
    (_event, file) => {
      if (file.endsWith(FEATURE_FILE_SUFFIX)) {
        renderChanged(file);
      } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        // Config or catalog changed: everything may be affected.
        renderAll();
      }
    },
    (error) => io.err(`Watcher error: ${error.message}`),
  );

  // chokidar keeps the process alive until the user interrupts.
  return EXIT_OK;
}
