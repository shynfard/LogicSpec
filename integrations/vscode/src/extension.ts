import fs from "node:fs";
import { featureStem, findFeatureFiles, loadWorkspace } from "logicspec";
import * as vscode from "vscode";
import { disposeDashboard, startDashboard } from "./dashboard.js";
import { debounce, type Debounced } from "./debounce.js";
import { FeatureTreeItem, FeatureTreeProvider } from "./features-tree.js";
import type { MappedDiagnostic } from "./mapping.js";
import { graphStartDir, WorkspaceGraphPreview } from "./graph-preview.js";
import { FeaturePreview } from "./preview.js";
import { clearWorkspaceCache, fileKind, validateContent } from "./validation.js";

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
    vscode.commands.registerCommand("logicspec.previewWorkspaceGraph", () => {
      const startDir = graphStartDir();
      if (startDir === undefined) {
        void vscode.window.showWarningMessage(
          "LogicSpec: open a folder or file inside a LogicSpec workspace first.",
        );
        return;
      }
      WorkspaceGraphPreview.show(context, startDir);
    }),
    vscode.commands.registerCommand("logicspec.validateWorkspace", () => {
      validateWorkspace(collection);
    }),
    vscode.commands.registerCommand("logicspec.startDashboard", () => {
      const startDir = graphStartDir();
      if (startDir === undefined) {
        void vscode.window.showWarningMessage(
          "LogicSpec: open a folder or file inside a LogicSpec workspace first.",
        );
        return;
      }
      startDashboard(context, startDir);
    }),
    vscode.commands.registerCommand(
      "logicspec.openFeatureInDashboard",
      (item?: FeatureTreeItem) => {
        if (item === undefined) return;
        const startDir = graphStartDir();
        if (startDir === undefined) {
          void vscode.window.showWarningMessage(
            "LogicSpec: open a folder or file inside a LogicSpec workspace first.",
          );
          return;
        }
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
    const dir = folder.uri.fsPath;
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
  void vscode.window.showInformationMessage(
    `LogicSpec: ${files} file(s) — ${errors} error(s), ${warnings} warning(s).`,
  );
}

export function deactivate(): void {
  disposeDashboard();
  // Other disposables are handled via context.subscriptions.
}
