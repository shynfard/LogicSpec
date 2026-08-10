# LogicSpec Editor

> **EXPERIMENTAL** — a local visual editor for LogicSpec feature files.
> The YAML stays the source of truth; the canvas is a projection of it.

A Vite + React + [React Flow](https://reactflow.dev) app for editing one
`*.feature.yaml` at a time:

- **YAML panel** (left) — edit source directly; the canvas re-derives after a
  400 ms debounce. Broken YAML keeps the last good graph on screen, dimmed,
  with the parse error in the diagnostics strip.
- **Canvas** (center) — one node per step with its type badge, label and actor;
  edge labels and kinds come from the normalized graph (event edges animate).
  Drag to rearrange (positions are ephemeral and never written to YAML).
- **Palette** — one button per step type; adds a minimal template step to the
  YAML document.
- **Inspector** (right) — rename a step id (updates `start` and every
  reference), edit label / actor / description and the type-specific field
  (`route`, `message`, `expression`).
- **Connect / delete** — draw an edge between nodes to add a type-appropriate
  transition; select a node or edge and press Delete to remove it from the
  document.
- **Diagnostics strip** (bottom) — the full validator output (LS codes,
  severity, message, location) for the current text.

## Run it

```bash
cd integrations/editor
npm install
npm run dev        # open the printed local URL
```

Other scripts: `npm run build`, `npm run typecheck`, `npm test`.

## How it works

The app imports the LogicSpec core **directly from source** — `vite.config.ts`
aliases `logicspec/core` to `../../src/core.ts` — so it never depends on the
root package being built. Parsing, validation, graph building and the
document-editing operations (`loadEditableFeature`, `addStep`, `renameStep`,
`addTransition`, …) all come from the core; the editor contains no DSL logic
of its own.

Two-way editing is powered by the core `src/edit/` module, which mutates the
parsed YAML document in place so comments and formatting of untouched lines
survive every edit. If that module is unavailable or an operation is invalid
(for example connecting *from* a `final` step), the editor shows the error as
a toast and leaves the YAML unchanged.

## Known limits (v0.4)

- One feature file at a time; catalogs (services/events) are not loaded, so
  catalog-dependent checks (LS104/LS105/…) don't run here — use
  `logicspec validate` for workspace-aware validation.
- Node positions are not persisted.
- Transition editing beyond add/remove (e.g. relabeling an outcome) still
  happens in the YAML panel.
