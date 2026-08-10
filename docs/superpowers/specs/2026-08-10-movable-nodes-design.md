# Movable diagram nodes (view-only) — design

Date: 2026-08-10 · Shipped in 0.5.7

## Goal

n8n-like hand-tidying of diagrams in the VS Code panels: drag any node to a
better position; connected edges and their labels follow. Strictly a view
concern — positions are never stored (not in YAML, not in settings); a
toolbar Reset restores Mermaid's layout and any re-render starts fresh.

## Approach

Manipulate the rendered Mermaid SVG in place (no canvas library, no second
renderer):

- **Nodes**: Mermaid positions each `g.node` via `transform: translate(cx, cy)`
  with the shape centered on the origin. Dragging adds an offset to that
  translate. Pointer deltas divide by the current zoom scale
  (clientWidth / viewBox width) so dragging is 1:1 at any zoom.
- **Edges**: each `path` in `g.edgePaths` carries `LS-<from>` / `LE-<to>`
  classes; endpoints resolve against the node registry. While a node moves,
  affected paths are rewritten as straight lines between node centers,
  clipped to each node's bounding rectangle (+padding) so arrowheads stay
  visible. Original `d` strings are kept for Reset.
- **Edge labels**: `g.edgeLabels` children pair with edge paths by index
  (Mermaid emits them in the same order); moved labels re-center on the
  clipped segment's midpoint. Original transforms kept for Reset.
- **Interaction split**: pointerdown on a node starts a node drag; on the
  background it starts a pan. A 4px threshold keeps click-to-navigate
  working; a real drag suppresses the following click.

## Non-goals

Persistence of positions (explicit user requirement), orthogonal edge
re-routing, dragging in the sequence view (it has no step nodes).

## Failure tolerance

Every lookup is best-effort: edges without resolvable endpoint classes stay
static, label pairing only applies when counts match, and the whole feature
degrades to the previous static behavior if Mermaid's DOM shape changes.
