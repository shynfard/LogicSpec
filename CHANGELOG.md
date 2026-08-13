# Changelog

All notable changes to LogicSpec. The DSL itself is versioned independently
(`version: "1"` in documents); this file tracks the toolchain.

## 0.6.0

Three **additive, backward-compatible** vocabulary extensions. Every field is
optional, so all existing specs stay valid.

- **Typed events**: an optional `eventKind` classifies an `event` step as
  `timer`, `message`, `signal`, `error` or `conditional`. Timers carry exactly
  one of `after` / `at` / `every` (`after`/`every` reuse the `wait` duration
  format); message/signal keep the `event` name; error takes an optional
  `name`; conditional takes a descriptive `when`. New diagnostic **LS305**
  (`INVALID_EVENT_KIND`) enforces per-kind consistency; an unknown `eventKind`
  is an LS002 schema error. The kind shows in the diagram marker
  (`EVENT · TIMER`).
- **Typed terminal states**: `final` steps accept an optional
  `terminate: boolean` (default `false`) meaning "end the whole flow instance,
  not just this path". A final's `kind` (`normal` / `error` / `terminate`) is
  derived, not stored. A terminated final gets a distinct diagram marker
  (`⦻ TERMINATE`).
- **Transition guards**: an optional descriptive `when` predicate (never
  evaluated, like a decision `cases[].when`) can annotate operation and subflow
  `on:` outcomes and page `actions`. Guards render on the edge label as
  `[when: …]`.
- New `examples/reminders/` demonstrates all three constructs; `docs/step-types.md`
  and `docs/validation.md` document the new fields and LS305.

Pre-release hardening of the same `0.6.0` vocabulary (no DSL change):

- **Object-input validation** now runs the file-local structural checks
  (LS301–LS306) too — previously `validateFeature()` on an already-parsed
  object skipped them, so LS305 could be bypassed programmatically.
- **LS305 hardened**: required per-kind event fields must be **non-blank** (an
  empty `event`/`when`/`at` no longer satisfies the requirement), and a
  `timer`/`conditional` event must use `direction: wait` (they are catch
  events and cannot be published).
- **LS306** (`BLANK_GUARD`): a descriptive `when` guard on an operation/subflow
  outcome or a page action that is present but blank is now rejected.
- **Error terminals render distinctly**: a `final` with `outcome: failure`
  (and no `terminate`) now shows `⊗ ERROR`, completing the
  normal / error / terminate three-way. The derivation is the single canonical
  `finalKind()`, now exported from the public API.
- `after` / `every` timer fields document that they are descriptive, never
  scheduled.

## 0.5.11

- Showcase screenshot (a real booking flow on the interactive canvas) in
  the README and the Marketplace listing.

## 0.5.10

- Project logo: banner in the README, square icon and light gallery banner
  on the VS Code Marketplace listing.

## 0.5.9

- **Interactive canvas view in VS Code (new default)**: the preview's
  "interactive" view renders on React Flow + dagre — professional node
  dragging (edges follow properly), zoom/pan, minimap and controls.
  Hovering a step spotlights it and its direct relations while everything
  unrelated fades; actors get stable deterministic colors (node accent,
  pill, minimap and a hover-aware legend); nodes carry requires/produces
  context chips. Single/double click semantics and the details drawer
  carry over. Positions remain view-only. The hand-rolled SVG node-drag
  from 0.5.7 is removed. Mermaid views stay available in the switcher.

## 0.5.8

- **Step inspector in the VS Code preview**: single-clicking a node opens a
  details drawer with the step's complete data (actor, call, event, flow,
  requires/produces, durations, tags, …) and every outgoing transition.
  Cross-file links open the exact location: the `services.yaml` operation,
  the `events.yaml` event, or the referenced subflow's feature file;
  transition entries jump to their target step. Double-click keeps the
  direct jump-to-definition. In the workspace graph, single and double
  click both open the feature's file.

## 0.5.7

- **Movable nodes in the VS Code panels** (n8n-style, view-only): drag any
  step to reposition it — connected edges re-route as border-clipped
  straight lines and their labels follow. Positions are never stored; the
  new **Reset** button (or any re-render) restores Mermaid's automatic
  layout. Node dragging, background panning, zooming and click-to-navigate
  coexist via pointer-target routing and a shared drag threshold.

## 0.5.6

- **Zoom & pan in the VS Code panels** (feature preview and workspace
  graph): Ctrl/Cmd+wheel zooms at the cursor, drag pans, toolbar gains
  − / % / + / Fit controls (% resets to 100%). Implemented by sizing the
  SVG directly so native scrolling does the panning and node clicks keep
  working; a drag suppresses the following click. Fit-to-panel remains
  the default and re-fits on panel resize.

## 0.5.5

- **Clickable diagrams in VS Code**: clicking a node in the feature preview
  jumps to (and selects) that step's YAML definition; clicking a feature in
  the workspace graph opens its file. Implemented with a strict-CSP-safe
  delegated listener — no Mermaid `securityLevel: loose`.
- New public helpers `mermaidNodeIdMap` and `workspaceGraphNodeIdMap`
  expose the renderers' node-id allocation for interactive hosts.

## 0.5.4

- VS Code extension is now a complete no-files experience:
  - view switcher inside the preview panel (flow / swimlane / sequence /
    event-model) — per-panel, no settings editing;
  - `LogicSpec: Preview Workspace Graph` — live dependency graph panel
    (subflow + event edges), refreshed on save, never written to disk;
  - README states the extension is fully self-contained (core bundled;
    the npm CLI is only for terminal/CI/MCP use).

## 0.5.3

- **Preview rendering fix** (VS Code extension and Obsidian plugin): Mermaid's
  HTML labels serialize as non-XML (`<foreignObject>` with unclosed `<br>`),
  so the strict `image/svg+xml` safety parse rejected every diagram
  ("Renderer returned unexpected content."). Output is now parsed as HTML
  with the `<svg>` element extracted, and the VS Code preview additionally
  renders with pure-SVG labels (`flowchart.htmlLabels: false`). A jsdom
  regression test pins both halves of the failure mode.

## 0.5.2

- **VS Code extension fix**: the 0.5.0/0.5.1 bundles crashed at load
  ("command 'logicspec.previewFeature' not found") because a module-scope
  `createRequire(import.meta.url)` in the bundled core became
  `createRequire(undefined)` under esbuild's CJS lowering. Version lookup
  is now lazy and guarded, and a bundle-load regression test activates the
  real built bundle against a stubbed VS Code host in CI.
- License changed from MIT to Apache-2.0 (artifacts published before
  0.5.2 immutably carry the license recorded at their publish time).
- README: Claude Code plugin installation guide.

## 0.5.1

- `logicspec export` — full workspace artifact build (per-feature Markdown
  and JSON models, dependency graph, workspace index, diagnostics) into the
  output directory.
- Output directory default changed from `./generated` to `./.logicspec`
  (a root dot-folder in the `.next` tradition). Set
  `output.directory: ./generated` in `logicspec.config.yaml` to keep the
  old location.
- VS Code extension: explorer/editor context-menu preview entries (working
  on unopened files), `Ctrl+Shift+V` / `Cmd+Shift+V` preview keybinding
  scoped to feature files.
- Dev-dependency updates (esbuild ≥ 0.25 advisory).

## 0.5.0

Roadmap milestones v0.2 through v0.5 in one release.

### Language & catalogs

- Service catalog operations may link into OpenAPI documents
  (`openapi: { document, operationId }`); events may link into AsyncAPI
  documents (`asyncapi: { document, channel }`). References are verified.
- Workspace config gains per-code severity overrides:
  `diagnostics: { LS200: "error", LS402: "off" }`.

### Validation

- **Data-flow analysis** (LS203): every `requires` must be produced on every
  path from `start` — must-availability fixpoint over the graph.
- Subflow outcome contracts (LS404): `on:` keys are checked against the
  target feature's final outcomes.
- Unused declarations: context variables (LS401) and actors (LS402), info.
- OpenAPI/AsyncAPI reference checks: LS108, LS109, plus method/path
  mismatch warnings (LS403).
- Diagnostics now carry end positions (`endLine`/`endColumn`) for editors.

### Views & tooling

- New experimental Mermaid views: `--view sequence` and `--view event-model`.
- `logicspec graph` — workspace dependency graph (features, subflows,
  event publish/wait edges, optional service nodes).
- `logicspec diff <before> <after>` — semantic feature diff (steps,
  transitions, actors, context, outcomes), `--json` for tooling.
- `logicspec validate` with no paths validates the whole workspace;
  `--json` emits a stable machine-readable report.
- `logicspec watch` re-renders subflow dependents of a changed feature.

### Integrations

- **MCP server** (`logicspec mcp`): dependency-free stdio JSON-RPC server
  exposing seven tools (`list_features`, `get_feature`, `get_step`,
  `get_transitions`, `get_service_dependencies`, `get_events`,
  `validate_feature`) to AI agents.
- **VS Code extension** (`integrations/vscode/`, experimental): inline
  diagnostics with exact ranges and a live Mermaid preview panel.
- **Visual editor** (`integrations/editor/`, experimental): React Flow
  canvas with two-way YAML ↔ graph editing, node palette and inspector,
  backed by the new document-preserving edit API.
- **Obsidian plugin** (`integrations/obsidian/`, experimental): renders
  `logicspec` / `logicspec-file` code blocks as validated diagrams in notes.
- **Claude Code plugin** (`integrations/claude-plugin/`): authoring skill,
  `/logicspec:feature` and `/logicspec:check` commands, MCP wiring;
  installable via the repo's plugin marketplace manifest.
- New `logicspec/core` subpath export: the browser-safe, fs-free API
  surface used by web tooling.
- New public edit API (`loadEditableFeature`, `addStep`, `renameStep`,
  `addTransition`, …) that preserves YAML comments and formatting.

## 0.1.0

Initial release: DSL v1 (nine step types), parser, structural + semantic
validation with stable LS diagnostics, Mermaid flowchart and experimental
swimlane renderers, Markdown wrapper, CLI (`init`, `validate`, `render`,
`inspect`, `watch`), JSON Schemas generated from the Zod sources, booking
example workspace, test suite and CI.
