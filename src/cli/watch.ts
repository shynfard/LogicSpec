import path from "node:path";
import chokidar from "chokidar";
import { FEATURE_FILE_SUFFIX, loadWorkspace } from "../workspace/loader.js";
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

  const watchTargets = [featuresDir];
  if (workspace.configPath !== undefined) {
    watchTargets.push(workspace.configPath);
    if (workspace.config.catalogs?.services) {
      watchTargets.push(path.resolve(workspace.root, workspace.config.catalogs.services));
    }
    if (workspace.config.catalogs?.events) {
      watchTargets.push(path.resolve(workspace.root, workspace.config.catalogs.events));
    }
  }

  const renderAll = () => {
    io.out(`${color.dim(timestamp())} validating ${path.relative(cwd, featuresDir) || "."} …`);
    runRender([featuresDir], { cwd, io });
  };

  const renderOne = (file: string) => {
    io.out(`${color.dim(timestamp())} ${path.relative(cwd, file)} changed`);
    runRender([file], { cwd, io });
  };

  io.out(`Watching ${path.relative(cwd, featuresDir) || "."} for changes. Ctrl+C to stop.`);
  renderAll();

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  watcher.on("all", (_event, file) => {
    if (file.endsWith(FEATURE_FILE_SUFFIX)) {
      renderOne(file);
    } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      // Config or catalog changed: everything may be affected.
      renderAll();
    }
  });

  watcher.on("error", (error) => {
    io.err(`Watcher error: ${(error as Error).message}`);
  });

  // chokidar keeps the process alive until the user interrupts.
  return EXIT_OK;
}
