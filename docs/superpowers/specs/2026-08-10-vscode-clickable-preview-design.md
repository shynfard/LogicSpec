# VS Code clickable diagrams — design

Date: 2026-08-10 · Shipped in 0.5.5

## Goal

Complete the no-files VS Code experience: diagrams are not just visible but
navigable — click a node in the feature preview to jump to that step's YAML
definition; click a feature in the workspace graph to open its file. No
export, no generated Markdown involved.

## Design

1. **Core helpers (public API)** — the renderers' deterministic node-id
   allocation is exposed instead of duplicated by hosts:
   - `mermaidNodeIdMap(graph)` → Mermaid node id → step id
     (matches flowchart exactly; swimlane/event-model diverge only on
     pathological sanitization collisions — documented).
   - `workspaceGraphNodeIdMap(features)` → Mermaid node id → feature id
     (mirrors the `feature:<id>` namespace of renderWorkspaceGraph).

2. **Webview** — one delegated click listener on the diagram container;
   clicks resolve `g.node[id]` ancestors, parse Mermaid's
   `flowchart-<nodeId>-<n>` DOM ids and post `{type: "nodeClick", node}`.
   Nodes get `cursor: pointer`. The sequence view has no step nodes; clicks
   are inert there by construction.

3. **Feature preview** — keeps the node map of the last render; on click,
   `parseFeature(source).locate(["steps", id])` supplies the precise range
   (start + end positions already exist) and the editor reveals + selects
   the step, reusing the editor column the document is already visible in.

4. **Workspace graph panel** — maps feature nodes to absolute file paths at
   render time; click opens the file.

## Rejected alternative

Mermaid's built-in `click` directives — they require `securityLevel: loose`
(script execution from diagram text), which the strict-CSP webview forbids.
The delegated-listener approach keeps `securityLevel: strict`.

## Testing

Core: `tests/renderer/node-id-map.test.ts` proves every mapped id appears as
a node declaration in the rendered output and that the workspace-graph map
mirrors the renderer's namespace. Extension: existing bundle-activation and
svg-extraction tests cover the pipeline; click handling is exercised
manually (webview DOM).
