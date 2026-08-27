import fs from "node:fs";
import { featureStem, type WorkspaceFeatureRef } from "logicspec";
import * as vscode from "vscode";
import { type FeatureSeverity, severityFor } from "./feature-severity.js";
import { validateContent, workspaceFor } from "./validation.js";
import { discoverWorkspaceRoots } from "./workspace-discovery.js";

/** Built lazily (not at module load) — constructing vscode.Theme* eagerly breaks under some hosts. */
function iconFor(severity: FeatureSeverity): vscode.ThemeIcon {
  switch (severity) {
    case "error":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"));
    case "warning":
      return new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor("problemsWarningIcon.foreground"),
      );
    case "valid":
      return new vscode.ThemeIcon("pass");
  }
}

export class FeatureTreeItem extends vscode.TreeItem {
  constructor(
    public readonly ref: WorkspaceFeatureRef,
    severity: FeatureSeverity,
  ) {
    const id = ref.id ?? featureStem(ref.path);
    super(ref.name ?? id, vscode.TreeItemCollapsibleState.None);
    this.description = id;
    this.tooltip = ref.path;
    this.resourceUri = vscode.Uri.file(ref.path);
    this.command = {
      command: "vscode.open",
      title: "Open Feature",
      arguments: [this.resourceUri],
    };
    this.contextValue = "logicspecFeature";
    this.iconPath = iconFor(severity);
  }
}

/**
 * Feeds the `logicspecFeatures` Activity Bar view: every feature in the
 * first workspace folder, sorted by display name, with a validity icon.
 * Recomputed on every `refresh()` — no caching beyond `workspaceFor`'s own
 * short TTL, so the tree matches what the diagnostics panel already shows.
 */
export class FeatureTreeProvider implements vscode.TreeDataProvider<FeatureTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: FeatureTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FeatureTreeItem[] {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) return [];
    // A folder may hold several nested workspaces (monorepo): union their
    // features instead of resolving only against the folder root.
    const roots = discoverWorkspaceRoots(folder.uri.fsPath);
    const dirs = roots.length > 0 ? roots : [folder.uri.fsPath];
    const seen = new Set<string>();
    const features = dirs.flatMap((dir) =>
      workspaceFor(dir).features.filter((ref) => {
        if (seen.has(ref.path)) return false;
        seen.add(ref.path);
        return true;
      }),
    );
    return features
      .map((ref) => {
        let content: string;
        try {
          content = fs.readFileSync(ref.path, "utf8");
        } catch {
          return new FeatureTreeItem(ref, "error");
        }
        return new FeatureTreeItem(ref, severityFor(validateContent(ref.path, content)));
      })
      .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }
}
