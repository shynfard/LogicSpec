import fs from "node:fs";
import path from "node:path";
import { featureStem, findFeatureFiles, loadWorkspace } from "logicspec";
import * as vscode from "vscode";
import { disposeDashboard, startDashboard } from "./dashboard.js";
import { debounce, type Debounced } from "./debounce.js";
import { FeatureTreeItem, FeatureTreeProvider } from "./features-tree.js";
import type { MappedDiagnostic } from "./mapping.js";
import { WorkspaceGraphPreview } from "./graph-preview.js";
import { FeaturePreview } from "./preview.js";
import { clearWorkspaceCache, fileKind, validateContent } from "./validation.js";
import { discoverWorkspaceRoots, resolveWorkspaceStartDir } from "./workspace-discovery.js";

/**
 * Which LogicSpec workspace should a command target? Walk up from the active
 * file first; otherwise discover workspaces nested below the VS Code folder
 * (monorepos keep several — resolving only against the folder root is what
 * used to produce "No logicspec.config.yaml found" there) and ask when more
 * than one qualifies.
 */
async function resolveStartDirInteractive(): Promise<string | undefined> {
  const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const resolution = resolveWorkspaceStartDir(activeFile, folder);
  if (resolution.dir !== undefined) return resolution.dir;
  const candidates = resolution.candidates ?? [];
  if (candidates.length === 0) {
    void vscode.window.showWarningMessage(
      "LogicSpec: no logicspec.config.yaml found — open a file inside a LogicSpec workspace, or scaffold one with `logicspec init`.",
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((dir) => ({
      label: path.basename(dir),
      description: folder !== undefined ? path.relative(folder, dir) || "." : dir,
      dir,
    })),
    { placeHolder: "Several LogicSpec workspaces found — pick one" },
  );
  return picked?.dir;
}

function toVscodeDiagnostics(mapped: MappedDiagnostic[]): vscode.Diagnostic[] {
  return mapped.map((entry) => {
    const range = new vscode.Range(
      entry.range.startLine,
      entry.range.startCharacter,
      entry.range.endLine,
      entry.range.endCharacter,
    );
    const diagnostic = new vscode.Diagnostic(
      range,
      entry.message,
      entry.severity as vscode.DiagnosticSeverity,
    );
    diagnostic.code = entry.code;
    diagnostic.source = entry.source;
    return diagnostic;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("logicspec");
  context.subscriptions.push(collection);

  const debouncers = new Map<string, Debounced<[]>>();

  const featureTree = new FeatureTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("logicspecFeatures", { treeDataProvider: featureTree }),
  );

  const refresh = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== "file") return;
    const kind = fileKind(document.uri.fsPath);
    if (kind === undefined) return;
    if (kind !== "feature") clearWorkspaceCache();
    collection.set(
      document.uri,
      toVscodeDiagnostics(validateContent(document.uri.fsPath, document.getText())),
    );
    if (kind !== "feature") {
      // Catalog or config changed: feature diagnostics may now be stale.
      for (const open of vscode.workspace.textDocuments) {
        if (open.uri.scheme === "file" && fileKind(open.uri.fsPath) === "feature") {
          collection.set(
            open.uri,
            toVscodeDiagnostics(validateContent(open.uri.fsPath, open.getText())),
          );
        }
      }
    }
    featureTree.refresh();
  };

  const debouncedRefresh = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    let debounced = debouncers.get(key);
    if (debounced === undefined) {
      debounced = debounce(() => refresh(document), 300);
      debouncers.set(key, debounced);
    }
    debounced();
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => debouncedRefresh(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => {
      collection.delete(document.uri);
      debouncers.get(document.uri.toString())?.cancel();
      debouncers.delete(document.uri.toString());
    }),
  );

  for (const document of vscode.workspace.textDocuments) refresh(document);

  context.subscriptions.push(
    vscode.commands.registerCommand("logicspec.previewFeature", async (uri?: vscode.Uri) => {
      // Invoked from the editor-title icon / keybinding (no argument) or
      // from an explorer/editor context menu (clicked resource URI).
      let document = vscode.window.activeTextEditor?.document;
      if (uri instanceof vscode.Uri) {
        document = await vscode.workspace.openTextDocument(uri);
      }
      if (document === undefined || fileKind(document.uri.fsPath) !== "feature") {
        void vscode.window.showWarningMessage(
          "LogicSpec: open a *.feature.yaml file to preview it.",
        );
        return;
      }
      FeaturePreview.show(context, document);
    }),
    vscode.commands.registerCommand("logicspec.previewWorkspaceGraph", async () => {
      const startDir = await resolveStartDirInteractive();
      if (startDir === undefined) return;
      WorkspaceGraphPreview.show(context, startDir);
    }),
    vscode.commands.registerCommand("logicspec.validateWorkspace", () => {
      validateWorkspace(collection);
    }),
    vscode.commands.registerCommand("logicspec.startDashboard", async () => {
      const startDir = await resolveStartDirInteractive();
      if (startDir === undefined) return;
      startDashboard(context, startDir);
    }),
    vscode.commands.registerCommand(
      "logicspec.openFeatureInDashboard",
      async (item?: FeatureTreeItem) => {
        if (item === undefined) return;
        // The tree item knows its own file — resolve the workspace from it,
        // not from whatever editor happens to be focused.
        const resolution = resolveWorkspaceStartDir(item.ref.path, undefined);
        const startDir = resolution.dir ?? (await resolveStartDirInteractive());
        if (startDir === undefined) return;
        const id = item.ref.id ?? featureStem(item.ref.path);
        startDashboard(context, startDir, `/features/${encodeURIComponent(id)}`);
      },
    ),
  );
}

function validateWorkspace(collection: vscode.DiagnosticCollection): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("LogicSpec: no workspace folder open.");
    return;
  }
  clearWorkspaceCache();
  let files = 0;
  let errors = 0;
  let warnings = 0;
  for (const folder of folders) {
    const folderDir = folder.uri.fsPath;
    // A folder may hold several nested workspaces (monorepo); validate each
    // against ITS config so catalog/subflow/details checks actually run.
    const roots = discoverWorkspaceRoots(folderDir);
    const dirs = roots.length > 0 ? roots : [folderDir];
    for (const dir of dirs) {
      const workspace = loadWorkspace(dir);
      const featureFiles =
        workspace.features.length > 0
          ? workspace.features.map((feature) => feature.path)
          : findFeatureFiles(dir);
      for (const file of featureFiles) {
        let content: string;
        try {
          content = fs.readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const mapped = validateContent(file, content);
        collection.set(vscode.Uri.file(file), toVscodeDiagnostics(mapped));
        files += 1;
        errors += mapped.filter((d) => d.severity === 0).length;
        warnings += mapped.filter((d) => d.severity === 1).length;
      }
    }
  }
  void vscode.window.showInformationMessage(
    `LogicSpec: ${files} file(s) — ${errors} error(s), ${warnings} warning(s).`,
  );
}

export function deactivate(): void {
  disposeDashboard();
  // Other disposables are handled via context.subscriptions.
}
