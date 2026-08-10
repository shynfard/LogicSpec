import path from "node:path";
import {
  featureStem,
  mermaidNodeIdMap,
  parseFeature,
  renderMermaid,
  validateFeature,
  type NormalizedFeature,
  type RenderView,
} from "logicspec";
import * as vscode from "vscode";
import { debounce, type Debounced } from "./debounce.js";
import { buildWebviewHtml } from "./graph-preview.js";
import { workspaceFor } from "./validation.js";

/** A navigation target offered in the step-details drawer. */
type DetailsLink =
  | { kind: "definition"; label: string; step: string }
  | { kind: "step"; label: string; step: string }
  | { kind: "service-op"; label: string; service: string; operation: string }
  | { kind: "event"; label: string; event: string }
  | { kind: "flow"; label: string; flow: string };

interface StepDetails {
  id: string;
  type: string;
  label: string;
  fields: Array<{ key: string; value: string }>;
  transitions: Array<{ label: string; to: string; kind: string }>;
  links: DetailsLink[];
}

const RENDER_VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];

function isRenderView(value: unknown): value is RenderView {
  return typeof value === "string" && (RENDER_VIEWS as readonly string[]).includes(value);
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
  /** Normalized model of the last valid render, for the details drawer. */
  private lastNormalized: NormalizedFeature | undefined;

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
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context, {
      bannerText: "Spec invalid — showing last valid render.",
    });

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
        } else if (typed.type === "nodeDetails" && typeof typed.node === "string") {
          this.sendDetails(typed.node);
        } else if (typed.type === "openLink") {
          void this.openLink((typed as { link?: DetailsLink }).link);
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
      this.lastNormalized = result.normalized;
      void this.panel.webview.postMessage({ type: "render", source: mermaid, view });
      void this.panel.webview.postMessage({ type: "stale", stale: false });
    } else {
      void this.panel.webview.postMessage({ type: "stale", stale: true });
    }
  }

  /** Single click → post the step's complete data to the details drawer. */
  private sendDetails(mermaidNodeId: string): void {
    const stepId = this.nodeMap.get(mermaidNodeId);
    const step = this.lastNormalized?.steps.find((candidate) => candidate.id === stepId);
    if (stepId === undefined || step === undefined) return;

    const fields: Array<{ key: string; value: string }> = [];
    const push = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        if (value.length > 0) fields.push({ key, value: value.join(", ") });
        return;
      }
      fields.push({ key, value: String(value) });
    };
    push("actor", step.actor);
    push("description", step.description);
    const def = step.def as Record<string, unknown>;
    for (const key of [
      "route",
      "call",
      "direction",
      "event",
      "flow",
      "duration",
      "timeout",
      "message",
      "outcome",
      "expression",
      "wait",
    ]) {
      push(key, def[key]);
    }
    push("requires", def.requires);
    push("produces", def.produces);
    push("states", def.states);
    push("tags", step.tags);
    push("notes", step.notes);
    if (step.def.type === "parallel") {
      push(
        "branches",
        Object.entries(step.def.branches).map(([id, branch]) => `${id} → ${branch.flow}`),
      );
    }

    const links: DetailsLink[] = [
      { kind: "definition", label: "Go to definition", step: step.id },
    ];
    if (step.def.type === "operation" && step.def.call !== undefined) {
      const [service, operation] = step.def.call.split(".");
      if (service && operation) {
        links.push({
          kind: "service-op",
          label: `services.yaml → ${step.def.call}`,
          service,
          operation,
        });
      }
    }
    if (step.def.type === "page") {
      for (const load of step.def.load ?? []) {
        const [service, operation] = load.call.split(".");
        if (service && operation) {
          links.push({
            kind: "service-op",
            label: `services.yaml → ${load.call} (load)`,
            service,
            operation,
          });
        }
      }
    }
    if (step.def.type === "event") {
      links.push({ kind: "event", label: `events.yaml → ${step.def.event}`, event: step.def.event });
    }
    if (step.def.type === "subflow") {
      links.push({
        kind: "flow",
        label: `open feature "${step.def.flow}"`,
        flow: step.def.flow,
      });
    }
    if (step.def.type === "parallel") {
      for (const branch of Object.values(step.def.branches)) {
        links.push({ kind: "flow", label: `open feature "${branch.flow}"`, flow: branch.flow });
      }
    }

    const details: StepDetails = {
      id: step.id,
      type: step.type,
      label: step.label,
      fields,
      transitions: step.transitions.map((t) => ({
        label: t.label ?? t.kind,
        to: t.to,
        kind: t.kind,
      })),
      links,
    };
    void this.panel.webview.postMessage({ type: "details", details });
  }

  /** Executes a details-drawer navigation. */
  private async openLink(link: DetailsLink | undefined): Promise<void> {
    if (link === undefined || typeof link !== "object") return;
    const workspace = workspaceFor(path.dirname(this.document.uri.fsPath));
    switch (link.kind) {
      case "definition":
      case "step": {
        await this.revealStepById(link.step);
        return;
      }
      case "service-op": {
        const file = workspace.catalogPaths.services;
        if (file === undefined) {
          void vscode.window.showWarningMessage("LogicSpec: no service catalog configured.");
          return;
        }
        const location = workspace.catalogLocators.services?.([
          "services",
          link.service,
          "operations",
          link.operation,
        ]);
        await openAt(file, location);
        return;
      }
      case "event": {
        const file = workspace.catalogPaths.events;
        if (file === undefined) {
          void vscode.window.showWarningMessage("LogicSpec: no event catalog configured.");
          return;
        }
        const location = workspace.catalogLocators.events?.(["events", link.event]);
        await openAt(file, location);
        return;
      }
      case "flow": {
        const ref = workspace.features.find(
          (candidate) => (candidate.id ?? featureStem(candidate.path)) === link.flow,
        );
        if (ref === undefined) {
          void vscode.window.showWarningMessage(
            `LogicSpec: feature "${link.flow}" was not found in this workspace.`,
          );
          return;
        }
        await openAt(ref.path, undefined);
        return;
      }
    }
  }

  /** Diagram double-click → reveal and select the step's definition. */
  private async revealStep(mermaidNodeId: string): Promise<void> {
    const stepId = this.nodeMap.get(mermaidNodeId);
    if (stepId === undefined) return;
    await this.revealStepById(stepId);
  }

  private async revealStepById(stepId: string): Promise<void> {
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

}

/** Opens a file, revealing a 1-based source location when provided. */
async function openAt(
  file: string,
  location: { line: number; column: number; endLine?: number; endColumn?: number } | undefined,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
  });
  if (location === undefined) return;
  const start = new vscode.Position(location.line - 1, location.column - 1);
  const end =
    location.endLine !== undefined && location.endColumn !== undefined
      ? new vscode.Position(location.endLine - 1, location.endColumn - 1)
      : start;
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
}
