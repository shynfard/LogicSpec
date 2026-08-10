import type { Diagnostic, RenderDirection, RenderView } from "logicspec/core";
import {
  type App,
  type Editor,
  loadMermaid,
  normalizePath,
  Plugin,
  PluginSettingTab,
  Setting,
  type TAbstractFile,
} from "obsidian";
import { DIRECTIONS, type FileBlockParams, parseFileBlock, VIEWS } from "./blockParams.js";
import { renderFeatureBlock, type RenderBlockResult } from "./render.js";

interface LogicSpecSettings {
  view: RenderView;
  direction: RenderDirection;
}

const DEFAULT_SETTINGS: LogicSpecSettings = {
  view: "flow",
  direction: "TD",
};

/** One rendered ```logicspec-file block, re-rendered when its file changes. */
interface TrackedFileBlock {
  el: HTMLElement;
  /** normalizePath()-ed vault path. */
  file: string;
  params: FileBlockParams;
}

let mermaidIdCounter = 0;

export default class LogicSpecPlugin extends Plugin {
  settings: LogicSpecSettings = { ...DEFAULT_SETTINGS };
  private trackedFileBlocks: TrackedFileBlock[] = [];

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new LogicSpecSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("logicspec", async (source, el) => {
      const result = renderFeatureBlock(source, {
        view: this.settings.view,
        direction: this.settings.direction,
      });
      await drawResult(el, result);
    });

    this.registerMarkdownCodeBlockProcessor("logicspec-file", async (source, el) => {
      const parsed = parseFileBlock(source);
      if (parsed.params === undefined) {
        drawErrorBox(el, parsed.errors);
        return;
      }
      const params = parsed.params;
      const file = normalizePath(params.file);
      this.trackedFileBlocks = this.trackedFileBlocks.filter((entry) => entry.el.isConnected);
      this.trackedFileBlocks.push({ el, file, params });
      await this.renderFileBlock(el, file, params);
    });

    this.registerEvent(
      this.app.vault.on("modify", (changed: TAbstractFile) => {
        this.trackedFileBlocks = this.trackedFileBlocks.filter((entry) => entry.el.isConnected);
        for (const entry of this.trackedFileBlocks) {
          if (entry.file === changed.path) {
            void this.renderFileBlock(entry.el, entry.file, entry.params);
          }
        }
      }),
    );

    this.addCommand({
      id: "insert-feature-diagram-block",
      name: "Insert feature diagram block",
      editorCallback: (editor: Editor) => {
        editor.replaceSelection(
          "```logicspec-file\nfile: features/example.feature.yaml\n```\n",
        );
      },
    });
  }

  override onunload(): void {
    this.trackedFileBlocks = [];
  }

  private async renderFileBlock(
    el: HTMLElement,
    file: string,
    params: FileBlockParams,
  ): Promise<void> {
    let source: string;
    try {
      source = await this.app.vault.adapter.read(file);
    } catch {
      drawErrorBox(el, [
        `Cannot read "${params.file}" from this vault. The path is vault-relative, e.g. "features/booking.feature.yaml".`,
      ]);
      return;
    }
    const result = renderFeatureBlock(source, {
      view: params.view ?? this.settings.view,
      direction: params.direction ?? this.settings.direction,
    });
    await drawResult(el, result, params.file);
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** Renders a validated result: diagram (when valid) plus diagnostics list. */
async function drawResult(
  el: HTMLElement,
  result: RenderBlockResult,
  sourceLabel?: string,
): Promise<void> {
  el.replaceChildren();
  el.classList.add("logicspec-block");

  if (result.mermaid !== undefined) {
    const holder = document.createElement("div");
    holder.className = "logicspec-diagram";
    try {
      const mermaid = await loadMermaid();
      mermaidIdCounter += 1;
      const { svg } = await mermaid.render(`logicspec-mmd-${mermaidIdCounter}`, result.mermaid);
      // Mermaid's htmlLabels output serializes as HTML (unclosed <br> etc.),
      // which strict XML parsing rejects — parse as HTML, extract the svg.
      const parsed = new DOMParser().parseFromString(svg, "text/html");
      const root = parsed.body.querySelector("svg");
      if (root === null) {
        throw new Error("mermaid did not return an SVG document");
      }
      holder.appendChild(document.importNode(root, true));
    } catch {
      // Rendering failed (very old Obsidian, or a Mermaid parse quirk):
      // fall back to the raw Mermaid text, which is still copy-pasteable.
      const pre = document.createElement("pre");
      pre.textContent = result.mermaid;
      holder.appendChild(pre);
    }
    el.appendChild(holder);
  } else {
    const header = document.createElement("div");
    header.className = "logicspec-invalid-header";
    header.textContent =
      sourceLabel === undefined
        ? "Invalid LogicSpec specification"
        : `Invalid LogicSpec specification: ${sourceLabel}`;
    el.appendChild(header);
  }

  if (result.diagnostics.length > 0) {
    el.appendChild(buildDiagnosticsList(result.diagnostics));
  }
}

function buildDiagnosticsList(diagnostics: readonly Diagnostic[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "logicspec-diagnostics";
  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");

    const badge = document.createElement("span");
    badge.className = `logicspec-badge logicspec-sev-${diagnostic.severity}`;
    badge.textContent = diagnostic.severity.toUpperCase();
    item.appendChild(badge);

    const code = document.createElement("code");
    code.textContent =
      diagnostic.location === undefined
        ? diagnostic.code
        : `${diagnostic.code} ${diagnostic.location.line}:${diagnostic.location.column}`;
    item.appendChild(code);

    item.appendChild(document.createTextNode(` ${diagnostic.message}`));
    list.appendChild(item);
  }
  return list;
}

function drawErrorBox(el: HTMLElement, messages: readonly string[]): void {
  el.replaceChildren();
  el.classList.add("logicspec-block");
  const box = document.createElement("div");
  box.className = "logicspec-error-box";
  for (const message of messages) {
    const line = document.createElement("div");
    line.textContent = message;
    box.appendChild(line);
  }
  el.appendChild(box);
}

class LogicSpecSettingTab extends PluginSettingTab {
  private readonly plugin: LogicSpecPlugin;

  constructor(app: App, plugin: LogicSpecPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.replaceChildren();

    new Setting(containerEl)
      .setName("Default view")
      .setDesc("Diagram view used when a block does not specify one.")
      .addDropdown((dropdown) => {
        for (const view of VIEWS) dropdown.addOption(view, view);
        dropdown.setValue(this.plugin.settings.view).onChange(async (value) => {
          this.plugin.settings.view = value as RenderView;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default direction")
      .setDesc("Flow direction for flowchart-style views.")
      .addDropdown((dropdown) => {
        for (const direction of DIRECTIONS) dropdown.addOption(direction, direction);
        dropdown.setValue(this.plugin.settings.direction).onChange(async (value) => {
          this.plugin.settings.direction = value as RenderDirection;
          await this.plugin.saveSettings();
        });
      });
  }
}
