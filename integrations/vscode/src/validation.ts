import path from "node:path";
import {
  loadConfig,
  loadWorkspace,
  parseEvents,
  parseServices,
  validateFeature,
  type Diagnostic,
  type Workspace,
} from "logicspec";
import { mapDiagnostic, type MappedDiagnostic } from "./mapping.js";

/**
 * Shared validation entry for every LogicSpec file kind the extension
 * understands. Workspaces (config + catalogs + feature index) are cached
 * per directory with a short TTL so keystroke-driven validation stays cheap.
 */
const WORKSPACE_TTL_MS = 2000;

interface CacheEntry {
  workspace: Workspace;
  loadedAt: number;
}

const workspaceCache = new Map<string, CacheEntry>();

export function workspaceFor(dir: string): Workspace {
  const now = Date.now();
  const hit = workspaceCache.get(dir);
  if (hit !== undefined && now - hit.loadedAt < WORKSPACE_TTL_MS) return hit.workspace;
  const workspace = loadWorkspace(dir);
  workspaceCache.set(dir, { workspace, loadedAt: now });
  return workspace;
}

/** Call when catalogs or config change so feature validation sees fresh state. */
export function clearWorkspaceCache(): void {
  workspaceCache.clear();
}

export type LogicSpecFileKind = "feature" | "services" | "events" | "config";

export function fileKind(filePath: string): LogicSpecFileKind | undefined {
  const base = path.basename(filePath);
  if (base.endsWith(".feature.yaml")) return "feature";
  if (base === "services.yaml") return "services";
  if (base === "events.yaml") return "events";
  if (base === "logicspec.config.yaml") return "config";
  return undefined;
}

/** Validates one file's content and returns editor-neutral diagnostics. */
export function validateContent(filePath: string, content: string): MappedDiagnostic[] {
  const kind = fileKind(filePath);
  let diagnostics: readonly Diagnostic[];
  switch (kind) {
    case "feature": {
      const workspace = workspaceFor(path.dirname(filePath));
      diagnostics = validateFeature(content, {
        file: filePath,
        services: workspace.services,
        events: workspace.events,
        knownFlows: workspace.knownFlows,
      }).diagnostics;
      break;
    }
    case "services":
      diagnostics = parseServices(content, { file: filePath }).diagnostics;
      break;
    case "events":
      diagnostics = parseEvents(content, { file: filePath }).diagnostics;
      break;
    case "config":
      // Config diagnostics come from disk state: loadConfig owns discovery
      // and defaulting, so unsaved edits surface on save.
      diagnostics = loadConfig(path.dirname(filePath)).diagnostics;
      break;
    default:
      diagnostics = [];
  }
  return diagnostics.map(mapDiagnostic);
}
