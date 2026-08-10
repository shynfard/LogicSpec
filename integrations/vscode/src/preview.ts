import path from "node:path";
import {
  mermaidNodeIdMap,
  parseFeature,
  renderMermaid,
  validateFeature,
  type RenderView,
} from "logicspec";
import * as vscode from "vscode";
import { debounce, type Debounced } from "./debounce.js";
import { workspaceFor } from "./validation.js";

const RENDER_VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];

function isRenderView(value: unknown): value is RenderView {
  return typeof value === "string" && (RENDER_VIEWS as readonly string[]).includes(value);
}

function nonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

/**
 * Live Mermaid preview for one feature file. Renders only when the spec is
 * valid; on invalid intermediate states the last good diagram stays visible
 * behind a "spec invalid" banner, so the preview never lies.
 */
export class FeaturePreview {
  private static current: FeaturePreview | undefined;

  static show(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
    if (FeaturePreview.current !== undefined) {
      FeaturePreview.current.retarget(document);
      FeaturePreview.current.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    FeaturePreview.current = new FeaturePreview(context, document);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly update: Debounced<[]>;
  private document: vscode.TextDocument;
  private ready = false;
  /** Per-panel view override; falls back to the logicspec.preview.view setting. */
  private view: RenderView | undefined;
  /** Mermaid node id → step id for the last rendered diagram. */
  private nodeMap: Map<string, string> = new Map();

  private constructor(context: vscode.ExtensionContext, document: vscode.TextDocument) {
    this.document = document;
    this.update = debounce(() => this.render(), 300);
    this.panel = vscode.window.createWebviewPanel(
      "logicspecPreview",
      FeaturePreview.title(document),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")],
      },
    );
    this.panel.webview.html = this.html(context);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const typed = message as { type?: string; view?: string; node?: string };
        if (typed.type === "ready") {
          this.ready = true;
          this.render();
        } else if (typed.type === "setView" && isRenderView(typed.view)) {
          this.view = typed.view;
          this.render();
        } else if (typed.type === "nodeClick" && typeof typed.node === "string") {
          void this.revealStep(typed.node);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === this.document) this.update();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("logicspec.preview.view")) this.render();
      }),
    );

    this.panel.onDidDispose(() => {
      this.update.cancel();
      for (const disposable of this.disposables) disposable.dispose();
      FeaturePreview.current = undefined;
    });
  }

  private static title(document: vscode.TextDocument): string {
    return `LogicSpec: ${path.basename(document.fileName)}`;
  }

  private retarget(document: vscode.TextDocument): void {
    this.document = document;
    this.panel.title = FeaturePreview.title(document);
    this.render();
  }

  private render(): void {
    if (!this.ready) return;
    const source = this.document.getText();
    const workspace = workspaceFor(path.dirname(this.document.uri.fsPath));
    const result = validateFeature(source, {
      file: this.document.uri.fsPath,
      services: workspace.services,
      events: workspace.events,
      knownFlows: workspace.knownFlows,
    });

    if (result.valid && result.normalized !== undefined && result.graph !== undefined) {
      const configured = vscode.workspace
        .getConfiguration("logicspec")
        .get<string>("preview.view", "flow");
      const view = this.view ?? (isRenderView(configured) ? configured : "flow");
      let mermaid: string;
      try {
        mermaid = renderMermaid(result.normalized, result.graph, { view });
      } catch {
        mermaid = renderMermaid(result.normalized, result.graph, { view: "flow" });
      }
      this.nodeMap = mermaidNodeIdMap(result.graph);
      void this.panel.webview.postMessage({ type: "render", source: mermaid, view });
      void this.panel.webview.postMessage({ type: "stale", stale: false });
    } else {
      void this.panel.webview.postMessage({ type: "stale", stale: true });
    }
  }

  /** Diagram click → reveal and select the step's definition in the editor. */
  private async revealStep(mermaidNodeId: string): Promise<void> {
    const stepId = this.nodeMap.get(mermaidNodeId);
    if (stepId === undefined) return;
    const parsed = parseFeature(this.document.getText(), { file: this.document.uri.fsPath });
    const location = parsed.locate(["steps", stepId]);
    if (location === undefined) return;

    const start = new vscode.Position(location.line - 1, location.column - 1);
    const end =
      location.endLine !== undefined && location.endColumn !== undefined
        ? new vscode.Position(location.endLine - 1, location.endColumn - 1)
        : start;
    const editor = await vscode.window.showTextDocument(this.document, {
      viewColumn:
        vscode.window.visibleTextEditors.find((e) => e.document === this.document)?.viewColumn ??
        vscode.ViewColumn.One,
      preserveFocus: false,
    });
    editor.selection = new vscode.Selection(start, start);
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
  }

  private html(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const scriptNonce = nonce();
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "mermaid.min.js"),
    );
    const previewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "preview.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "preview.css"),
    );
    return [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="UTF-8">',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${scriptNonce}';">`,
      `<link rel="stylesheet" href="${styleUri.toString()}">`,
      "</head>",
      "<body>",
      '<div id="banner" hidden>Spec invalid — showing last valid render.</div>',
      '<div id="toolbar" hidden><label>View <select id="view">',
      '<option value="flow">flow</option>',
      '<option value="swimlane">swimlane</option>',
      '<option value="sequence">sequence</option>',
      '<option value="event-model">event-model</option>',
      "</select></label></div>",
      '<div id="diagram"></div>',
      `<script nonce="${scriptNonce}" src="${mermaidUri.toString()}"></script>`,
      `<script nonce="${scriptNonce}" src="${previewUri.toString()}"></script>`,
      "</body>",
      "</html>",
    ].join("\n");
  }
}
