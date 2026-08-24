import fs from "node:fs";
import path from "node:path";
import { type FileTarget, validateTarget } from "../cli/shared.js";
import type { ValidationResult } from "../validator/validate.js";
import { featureStem, type Workspace, type WorkspaceFeatureRef } from "../workspace/loader.js";

/** One feature file plus its validated model, ready for dashboard rendering. */
export interface FeatureRecord {
  id: string;
  name: string;
  ref: WorkspaceFeatureRef;
  target: FileTarget;
  source: string;
  result: ValidationResult;
}

/**
 * Loads and validates every feature in the workspace. Re-reads and
 * re-validates from disk on every call — the dashboard always reflects the
 * current file state, the same "correctness over latency" stance as the
 * MCP server (docs/integrations.md).
 */
export function loadFeatureRecords(workspace: Workspace, cwd: string): FeatureRecord[] {
  const workspaceFor = () => workspace;
  return workspace.features.map((ref) => {
    const target: FileTarget = {
      path: ref.path,
      display: path.relative(cwd, ref.path) || ref.path,
    };
    const { result } = validateTarget(target, workspaceFor);
    let source = "";
    try {
      source = fs.readFileSync(ref.path, "utf8");
    } catch {
      source = "";
    }
    return {
      id: ref.id ?? featureStem(ref.path),
      name: ref.name ?? ref.id ?? featureStem(ref.path),
      ref,
      target,
      source,
      result,
    };
  });
}

export function findFeatureRecord(
  records: readonly FeatureRecord[],
  id: string,
): FeatureRecord | undefined {
  return records.find((record) => record.id === id);
}
