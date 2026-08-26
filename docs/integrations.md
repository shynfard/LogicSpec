# Integrations

Everything here builds on the public library API; the core package never depends on any of it. The VS Code extension and the visual editor are self-contained packages under `integrations/` — install and build *inside* their directories. Both are experimental.

## MCP server

`logicspec mcp [dir]` runs a [Model Context Protocol](https://modelcontextprotocol.io) server over stdio, exposing the workspace at `dir` (default: current directory) to AI agents. It is JSON-RPC 2.0, newline-delimited UTF-8, implemented with **zero additional dependencies**, and speaks protocol versions `2024-11-05`, `2025-03-26` and `2025-06-18`.

Register with Claude Code:

```bash
claude mcp add logicspec -- logicspec mcp /path/to/your/workspace
```

Any other stdio MCP client works the same way — point it at the `logicspec mcp <dir>` command.

### Tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `list_features` | — | Every feature: id, file, name, validity |
| `get_feature` | `feature` | The full inspect report (steps, edges, terminals, services, events, stats) |
| `get_step` | `feature`, `step` | One step: type, label, definition, outgoing transitions |
| `get_transitions` | `feature`, `from?` | Edge list, optionally filtered by source step |
| `get_service_dependencies` | `feature?` | Services and operations called (one feature, or the whole workspace) |
| `get_events` | `feature?` | Events published/waited on, enriched from the event catalog |
| `validate_feature` | `feature` | The same verdict as `logicspec validate`: diagnostics with severity overrides applied, plus workspace-level catalog findings |
| `render_feature` | `feature`, `view?`, `direction?` | Mermaid source for one view (flow, swimlane, sequence, event-model) |
| `diff_feature` | `feature`, `proposed_source` | Semantic diff between the file on disk and a proposed YAML replacement |
| `get_data_flow` | `feature`, `key?` | Which steps and page actions produce/require each context key |

`feature` accepts a feature id or a file stem. The workspace is reloaded on every call — agents always see the current file state; correctness over latency.

Tool-level failures (unknown feature, unknown step) come back as `isError` tool results with a plain-text explanation; protocol misuse (unknown tool, invalid arguments) is a JSON-RPC error.

## Dashboard server

`logicspec serve [dir]` runs a local dashboard at `http://127.0.0.1:27000` by default (`--port`, `--host`, `--open`) — a React single-page app (Vite, shadcn/ui) served by a small JSON API. Every feature is listed and clickable; each detail page has a diagram tab (an interactive drag/zoom/pan canvas by default — the same experience as the VS Code preview's interactive view — plus the four Mermaid views), raw source, the `inspect` model, diagnostics, and cross-feature links (subflow calls, dependents, shared events). An MCP page shows the registration command and tool table for AI agents. Live-reloads on every save via Server-Sent Events, without a full page refresh. No editing — for that, use the visual editor below.

## VS Code extension (`integrations/vscode/`)

Published on the Marketplace as
[`Shynfard.logicspec-vscode`](https://marketplace.visualstudio.com/items?itemName=Shynfard.logicspec-vscode);
fully self-contained (the core is bundled — no CLI required).

* Inline diagnostics for `*.feature.yaml`, `services.yaml`, `events.yaml` and `logicspec.config.yaml` — on open, change (debounced) and save, with exact source ranges and LS codes, validated against the surrounding workspace (catalogs, subflows).
* **Live preview** (editor-title icon, right-click, `Ctrl+Shift+V`) with an in-panel view switcher: the default **interactive** view is a React Flow canvas — drag nodes (edges follow), zoom/pan with minimap and controls, hover a step to spotlight it and its direct relations, stable per-actor colors with a hover-aware legend, requires/produces chips — plus the four Mermaid views (`flow` | `swimlane` | `sequence` | `event-model`). While the spec is broken the last valid render stays visible, flagged.
* **Step inspector**: single-click a node for its complete data and links that open the exact `services.yaml` operation, `events.yaml` event, subflow feature files and transition targets; double-click jumps straight to the step's YAML.
* **LogicSpec: Preview Workspace Graph** — a live feature/subflow/event dependency panel; clicking a feature opens its file.
* **LogicSpec: Validate Workspace** — validates every feature file and summarizes.
* **LogicSpec: Start Dashboard** — launches the local dashboard server (above) and opens it in your default browser.
* **Activity Bar "LogicSpec" view** — a Features list (like Explorer/Search) for the workspace: every feature with a validity icon, click to open its file, right-click "Open in Dashboard" to jump straight to that feature's dashboard page (starting the server if needed), and a title-bar button to start the dashboard.

Positions on the interactive canvas are view-only — never persisted.

Development loop:

```bash
npm install && npm run build   # from the repo root, once
cd integrations/vscode
npm install
npm run build     # esbuild bundle + bundled mermaid asset + dashboard client copy
# open the folder in VS Code and press F5 (launch config included)
```

The extension's build copies the dashboard's built static assets (`dist/server/public`) into `media/dashboard/` for the "Start Dashboard" command — that's why the root build has to run first.

Package a `.vsix` with `npx @vscode/vsce package --no-dependencies`. Validation runs in the extension host (no language server yet — a future refinement).

## Visual editor (`integrations/editor/`)

A local React Flow app for two-way YAML ↔ visual editing of one feature at a time:

* three panels — YAML source, canvas, inspector — plus a palette of the nine step types and a diagnostics strip;
* canvas edits (add step, connect, delete, rename, relabel) are written back **through the document-preserving edit API**, so comments, key order and formatting in your YAML survive;
* YAML edits re-derive the graph (debounced); while the YAML is broken the last good graph stays, dimmed, with diagnostics listed.

```bash
cd integrations/editor
npm install
npm run dev       # opens the Vite dev server
```

Limitations (by design, for now): one file at a time via Open/Save/Copy; node positions are ephemeral; catalog-aware checks (LS104/LS105-class) don't run in-browser.

## Obsidian plugin (`integrations/obsidian/`)

**Experimental.** Renders LogicSpec features as diagrams inside Obsidian notes.

Two code-block languages:

- ` ```logicspec ` — the block body is a complete feature YAML. Valid specs
  render as a Mermaid diagram (default view/direction from the plugin
  settings) with any warnings/infos listed underneath; invalid specs show the
  diagnostics list only — never a stale diagram.
- ` ```logicspec-file ` — the block body references a vault file:

  ```yaml
  file: features/booking.feature.yaml
  view: swimlane        # optional: flow | swimlane | sequence | event-model
  direction: LR         # optional: TD | TB | LR | RL | BT
  ```

  Referenced files re-render automatically when they change in the vault.

Also included: a settings tab (default view and direction) and an
"Insert feature diagram block" command.

Limitations: validation inside Obsidian is file-local — catalog, subflow and
workspace checks (LS104/LS105/LS106-class) don't run; use `logicspec validate`
for the full picture. Mermaid comes from Obsidian itself (`minAppVersion`
1.4.0).

Install: `npm install && npm run build` inside `integrations/obsidian/`, then
copy `dist/` to `<vault>/.obsidian/plugins/logicspec/` and enable the plugin
(or point BRAT at a release that carries `main.js`, `manifest.json`,
`styles.css`).

## Claude Code plugin (`integrations/claude-plugin/`)

Teaches AI agents the DSL instead of letting them guess it.

- **Skill `logicspec-authoring`**: the closed nine-type vocabulary, transition
  rules (`next` XOR `on`, event directions, final terminality), context
  data-flow expectations, catalog linking, and the mandatory
  validate-fix-render loop — with condensed grammar and per-LS-code fix
  references loaded on demand.
- **Skill `logicspec-implementing`**: the consuming side — reading a spec as
  an implementation contract (step type → implementation obligation) and
  deriving unit/integration/E2E tests from it (per-outcome matrices,
  boundary/timeout tests, data-flow assertions, journey scripting from
  pages' routes and action labels), with a worked derivation for the booking
  example.
- **Commands**: `/logicspec:feature <description>` designs a spec end to end;
  `/logicspec:check [path]` validates and repairs a workspace by LS code;
  `/logicspec:tests <feature> [framework]` derives a coverage checklist and
  test plan from a spec and writes the tests.
- **MCP**: registers `logicspec mcp` so agents can query features/steps/
  transitions/dependencies structurally instead of re-parsing YAML.

Install: `/plugin marketplace add shynfard/LogicSpec`, then
`/plugin install logicspec@logicspec`. Requires the `logicspec` CLI on PATH
for validation and MCP (falls back to `npx logicspec`).

## Edit API (for tool builders)

The editor's write-path is public API, exported from both `logicspec` and `logicspec/core`:

```ts
import {
  loadEditableFeature, serializeFeature, reparse,
  addStep, deleteStep, renameStep, setStepField,
  addTransition, removeTransitionAt,
} from "logicspec/core";
```

All mutations operate on the underlying `yaml` Document — comments, blank lines and key order of untouched content are preserved byte-for-byte. `renameStep` updates `start` and every reference; `deleteStep` removes dangling transitions; `addTransition` picks the type-appropriate construct (page action, `on` outcome, decision case, `next`) and converts an operation's bare `next` into an `on` outcome rather than ever producing an invalid both-`next`-and-`on` step.

One caveat: `serializeFeature` throws on a document with YAML *syntax* errors (stringifying a half-parsed tree could silently drop content) — gate on the LS001 diagnostic from `loadEditableFeature` first. Schema-invalid but syntactically sound documents serialize fine.

## `logicspec/core`

The browser-safe subpath export: the full parse → normalize → graph → validate → render → edit surface with everything file-system-dependent (workspace loading, CLI, MCP server) excluded. Web tooling should import from `logicspec/core`; Node tooling can use either entry point.
