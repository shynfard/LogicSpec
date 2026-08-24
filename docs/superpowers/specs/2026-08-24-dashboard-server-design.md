# Local dashboard server — design

Date: 2026-08-24

## Goal

A local HTTP server (`logicspec serve`, also launchable from VS Code) that
hosts a read-only, browsable website over an entire LogicSpec workspace: a
dashboard listing every feature, and a full-detail page per feature (diagram,
source, inspect data, diagnostics, cross-references). Every reference to
another feature — subflow calls, dependents, shared events, diagram nodes
that represent a subflow step — is a clickable link that opens that other
feature's detail page. Auto-refreshes on file change. No editing.

## Non-goals

Not an editor (that's `integrations/editor`). Not a replacement for the VS
Code preview (single-file, in-editor). Not a static-site generator — pages
render on request from the live workspace, nothing is written to disk.

## Module layout

New `src/server/` — an fs/network-touching module, same tier as
`src/workspace/`, `src/cli/`, `src/mcp/` (not part of the fs-free
`src/core.ts` surface, per rule 11).

- `create-server.ts` — `createDashboardServer(workspaceDir, { port, host })
  → http.Server`. Plain Node `http`, hand-rolled routing. No framework
  dependency.
- `pages/dashboard.ts` — `GET /`: every feature in the workspace, grouped by
  directory. Each card: name, file path, validation badge (pass / warn /
  error, from `validate()`), step count. Click → detail page.
- `pages/feature-detail.ts` — `GET /features/:id`: header (name, path,
  validation badge) plus:
  - **View tabs** — flow / swimlane / sequence / event-model, each
    server-rendered Mermaid, `securityLevel: strict` on the client.
  - **Source** — raw YAML, HTML-escaped.
  - **Inspect** — `inspect()` output, pretty-printed JSON.
  - **Diagnostics** — this feature's validation issues with severity and
    location.
  - **Related** — subflow calls, dependents (`featureDependents()`), and
    features sharing an event (publish/wait on the same event name); each
    entry an `<a href="/features/<id>">`.
- `links.ts` — resolves subflow/event references to target feature ids, for
  the Related section.
- `assets.ts` — serves the `mermaid` package's prebuilt browser bundle
  (new root dependency, version-matched to `integrations/vscode`'s
  `^11.0.0`) straight out of `node_modules` at request time. No bundler.
- Live reload — the chokidar watch logic already in `src/cli/watch.ts` is
  factored into a small shared `watchWorkspace(dir, onChange)` helper so
  `watch` and `serve` share one implementation. `serve` wires it to an SSE
  endpoint (`GET /events`); a small inline client script reloads the page
  on message.

## Diagram linkability — reuse the VS Code click pattern, not Mermaid `click`

`docs/superpowers/specs/2026-08-10-vscode-clickable-preview-design.md`
already rejected Mermaid's built-in `click` directives for this codebase:
they require `securityLevel: loose` (script execution sourced from diagram
text), which the project treats as unacceptable even though YAML-derived
diagram content is escaped elsewhere (rule 6: labels/notes are opaque data,
never executed). The dashboard reuses that precedent instead of
reintroducing the rejected approach:

- Client-side: one delegated click listener per diagram container, same as
  the webview. Clicks resolve to a Mermaid DOM node id, which maps to a step
  id via the existing public helpers `mermaidNodeIdMap(graph)` /
  `workspaceGraphNodeIdMap(features)` (`src/renderers/mermaid-common.ts`,
  `src/renderers/workspace-graph.ts`, already exported from `src/index.ts` —
  built for exactly this purpose during the 2026-08-10 work).
- Server-side, embedded per page as JSON: for each step id, whether it's a
  `subflow` step and, if so, its `flow` target (the schema's
  `subflowStepSchema.flow` field is already the target feature id — no
  extra resolution needed).
- On click: if the step is a subflow step, navigate to
  `/features/<flow>`. Otherwise, scroll to and highlight that step in the
  page's Source/Inspect panels (no navigation — nothing to link to).
- Mermaid stays at `securityLevel: strict` throughout, consistent with the
  webview.

## CLI

`src/cli/serve.ts`, thin wrapper over `src/server/`:

```
logicspec serve [dir] [--port 27000] [--host 127.0.0.1] [--open]
```

Binds `127.0.0.1` by default — this serves local spec files, not a service
meant for the network. `--open` shells out to the platform opener (`open` /
`start` / `xdg-open`) rather than adding an `open`-style dependency.

## VS Code integration

New command `LogicSpec: Start Dashboard` in `integrations/vscode/`. Imports
`createDashboardServer` from the aliased `../../src` (matching how the
extension already bundles core, never from `dist`, per the integrations
rule). Keeps one server instance per workspace folder — re-invoking the
command reuses it and just re-opens the browser rather than starting a
duplicate — and disposes it on deactivate. Opens the URL with
`vscode.env.openExternal`.

## Security

Detail pages render arbitrary YAML-derived strings (labels, notes,
descriptions — opaque user data per rule 6). All of it goes through a new
`escapeHtml` helper before landing in generated HTML; this is a distinct
escaping context from the existing `escapeMermaid` and must not be
conflated with it. Diagram click-through carries only step ids and feature
ids (both from `identifierSchema`, not free text), so no user-controlled
string reaches a URL or a script context.

## Testing

- `tests/server/` — route handlers as functions of `(workspace, request) →
  { status, body }`, no real socket, mirroring the rest of `tests/`.
- A small integration suite starts the real server on an ephemeral port and
  fetches `/`, `/features/:id`, and `/events` against `examples/booking`
  (the canonical workspace).
- Structural assertions on generated HTML (contains expected names, expected
  `href`s) — not full-page snapshots; the snapshot-testing convention is
  reserved for the deterministic Mermaid/Markdown renderer output, and
  dashboard HTML isn't part of that byte-identical-output contract.
- `tests/renderer/node-id-map.test.ts` (existing) already covers the id-map
  helpers this design reuses; no changes needed there.
