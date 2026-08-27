import path from "node:path";
import {
  featureStem,
  renderWorkspaceGraph,
  workspaceGraphNodeIdMap,
  type WorkspaceFeatureSummary,
} from "logicspec";
import * as vscode from "vscode";
import { debounce, type Debounced } from "./debounce.js";
import { workspaceFor } from "./validation.js";

/**
 * Live workspace dependency graph: features, subflow edges, event
 * publish/wait edges. Rendered entirely in the panel — no files written.
 */
export class WorkspaceGraphPreview {
  private static current: WorkspaceGraphPreview | undefined;

  static show(context: vscode.ExtensionContext, startDir: string): void {
    if (WorkspaceGraphPreview.current !== undefined) {
      WorkspaceGraphPreview.current.startDir = startDir;
      WorkspaceGraphPreview.current.panel.reveal(vscode.ViewColumn.Beside, true);
      WorkspaceGraphPreview.current.render();
      return;
    }
    WorkspaceGraphPreview.current = new WorkspaceGraphPreview(context, startDir);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly update: Debounced<[]>;
  private startDir: string;
  private ready = false;
  /** Mermaid node id → absolute feature file path for the last render. */
  private nodeToFile: Map<string, string> = new Map();

  private constructor(context: vscode.ExtensionContext, startDir: string) {
    this.startDir = startDir;
    this.update = debounce(() => this.render(), 500);
    this.panel = vscode.window.createWebviewPanel(
      "logicspecWorkspaceGraph",
      "LogicSpec: Workspace Graph",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const typed = message as { type?: string; node?: string };
        if (typed.type === "ready") {
          this.ready = true;
          this.render();
        } else if (
          (typed.type === "nodeClick" || typed.type === "nodeDetails") &&
          typeof typed.node === "string"
        ) {
          // Feature nodes have no drawer here — single and double click both
          // open the feature's file.
          const file = this.nodeToFile.get(typed.node);
          if (file !== undefined) {
            void vscode.window.showTextDocument(vscode.Uri.file(file), {
              viewColumn: vscode.ViewColumn.One,
            });
          }
        }
      }),
      // Any saved YAML may change the graph (features, catalogs, config).
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.fsPath.endsWith(".yaml") || document.uri.fsPath.endsWith(".yml")) {
          this.update();
        }
      }),
    );

    this.panel.onDidDispose(() => {
      this.update.cancel();
      for (const disposable of this.disposables) disposable.dispose();
      WorkspaceGraphPreview.current = undefined;
    });
  }

  private render(): void {
    if (!this.ready) return;
    const workspace = workspaceFor(this.startDir);
    const summaries: WorkspaceFeatureSummary[] = workspace.features
      .map((ref) => ({
        id: ref.id ?? featureStem(ref.path),
        name: ref.name ?? ref.id ?? featureStem(ref.path),
        subflows: [...ref.flows].sort(),
        publishes: [...ref.publishes].sort(),
        waitsFor: [...ref.waitsFor].sort(),
        services: [...ref.services].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (summaries.length === 0) {
      void this.panel.webview.postMessage({ type: "stale", stale: true });
      return;
    }
    const idMap = workspaceGraphNodeIdMap(summaries);
    this.nodeToFile = new Map();
    for (const [mermaidId, featureId] of idMap) {
      const ref = workspace.features.find(
        (candidate) => (candidate.id ?? featureStem(candidate.path)) === featureId,
      );
      if (ref !== undefined) this.nodeToFile.set(mermaidId, ref.path);
    }
    const mermaid = renderWorkspaceGraph(summaries, { direction: "LR" });
    void this.panel.webview.postMessage({ type: "render", source: mermaid });
    void this.panel.webview.postMessage({ type: "stale", stale: false });
  }
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

/** Shared webview shell: strict CSP, bundled mermaid, preview script. */
export function buildWebviewHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
  options: { bannerText?: string } = {},
): string {
  const scriptNonce = nonce();
  const bannerText = options.bannerText ?? "Nothing to render yet.";
  const mermaidUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "mermaid.min.js"),
  );
  const previewUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "preview.js"),
  );
  const canvasUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "canvas.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "preview.css"),
  );
  const canvasStyleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "media", "canvas.css"),
  );
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${scriptNonce}';">`,
    `<link rel="stylesheet" href="${styleUri.toString()}">`,
    `<link rel="stylesheet" href="${canvasStyleUri.toString()}">`,
    "</head>",
    "<body>",
    `<div id="banner" hidden>${bannerText}</div>`,
    '<div id="toolbar">',
    '<label id="view-label" hidden>View <select id="view">',
    '<option value="interactive">interactive</option>',
    '<option value="flow">flow</option>',
    '<option value="swimlane">swimlane</option>',
    '<option value="sequence">sequence</option>',
    '<option value="event-model">event-model</option>',
    "</select></label>",
    '<span id="zoom">',
    '<button id="zoom-out" title="Zoom out">−</button>',
    '<button id="zoom-level" title="Reset to 100%">100%</button>',
    '<button id="zoom-in" title="Zoom in">+</button>',
    '<button id="zoom-fit" title="Fit to panel">Fit</button>',
    "</span>",
    "</div>",
    '<div id="diagram"></div>',
    '<div id="canvas" hidden></div>',
    `<script nonce="${scriptNonce}" src="${mermaidUri.toString()}"></script>`,
    `<script nonce="${scriptNonce}" src="${previewUri.toString()}"></script>`,
    `<script nonce="${scriptNonce}" src="${canvasUri.toString()}"></script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

