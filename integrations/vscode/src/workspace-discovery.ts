import fs from "node:fs";
import path from "node:path";

/**
 * Pure workspace discovery (no vscode imports — unit-testable): where are the
 * LogicSpec workspaces relative to what the user has open?
 *
 * A VS Code folder is often NOT itself a LogicSpec workspace: monorepos keep
 * several nested workspaces (this repository's `examples/*` is exactly that).
 * Resolving everything against the folder root then fails with "No
 * logicspec.config.yaml found" even though workspaces sit one level down.
 */

const CONFIG_NAME = "logicspec.config.yaml";
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "coverage"]);
const MAX_DEPTH = 6;

/**
 * All directories at or below `root` containing a logicspec.config.yaml,
 * sorted, depth-capped, skipping dependency/build/hidden directories.
 */
export function discoverWorkspaceRoots(root: string, maxDepth = MAX_DEPTH): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === CONFIG_NAME)) {
      found.push(dir);
      // A workspace does not nest further workspaces; stop descending.
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

/** Nearest directory at or above `startDir` containing a config, if any. */
export function nearestWorkspaceRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_NAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface StartDirResolution {
  /** Unambiguous workspace root, when one could be determined. */
  dir?: string;
  /** Candidates for the caller to offer as a picker (2+ discovered roots). */
  candidates?: string[];
}

/**
 * Resolves which workspace a command should target:
 * 1. the workspace surrounding the active file (walking UP), else
 * 2. the folder itself if it is a workspace, else
 * 3. the single workspace discovered BELOW the folder, else
 * 4. all discovered roots as picker candidates (empty candidates = none).
 */
export function resolveWorkspaceStartDir(
  activeFile: string | undefined,
  workspaceFolder: string | undefined,
): StartDirResolution {
  if (activeFile !== undefined) {
    const fromActive = nearestWorkspaceRoot(path.dirname(activeFile));
    if (fromActive !== undefined) return { dir: fromActive };
  }
  if (workspaceFolder === undefined) return { candidates: [] };
  const roots = discoverWorkspaceRoots(workspaceFolder);
  if (roots.length === 1) return { dir: roots[0] };
  return { candidates: roots };
}
