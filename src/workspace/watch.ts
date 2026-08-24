import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Workspace } from "./loader.js";

/**
 * Paths chokidar should watch for a workspace: the features directory plus,
 * when a config was found, the config file and configured catalogs. Falls
 * back to `startDir` itself without a config, matching `watch`'s original
 * "just watch this directory" behavior for config-less usage.
 */
export function watchTargetsFor(workspace: Workspace, startDir: string): string[] {
  const featuresDir =
    workspace.configPath !== undefined
      ? path.resolve(workspace.root, workspace.config.features.directory)
      : startDir;

  const targets = [featuresDir];
  if (workspace.configPath !== undefined) {
    targets.push(workspace.configPath);
    if (workspace.config.catalogs?.services) {
      targets.push(path.resolve(workspace.root, workspace.config.catalogs.services));
    }
    if (workspace.config.catalogs?.events) {
      targets.push(path.resolve(workspace.root, workspace.config.catalogs.events));
    }
  }
  return targets;
}

/**
 * Watches the given paths and invokes `onEvent` for every chokidar change
 * after the initial scan. Shared by `logicspec watch` (re-renders) and
 * `logicspec serve` (live-reload) so both watch exactly the same targets.
 */
export function watchWorkspace(
  targets: readonly string[],
  onEvent: (event: string, file: string) => void,
  onError: (error: Error) => void,
): FSWatcher {
  const watcher = chokidar.watch([...targets], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  watcher.on("all", onEvent);
  watcher.on("error", (error) => onError(error as Error));
  return watcher;
}
