import type { FeatureGraph } from "logicspec/core";

export interface Position {
  x: number;
  y: number;
}

export const COLUMN_WIDTH = 260;
export const ROW_HEIGHT = 120;

/**
 * Deterministic layered layout: column = BFS depth from `start`,
 * row = source order within the layer. Unreachable steps share one
 * trailing column after the deepest reachable layer.
 */
export function layoutPositions(graph: FeatureGraph): Map<string, Position> {
  const known = new Set(graph.nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (known.has(edge.from) && known.has(edge.to)) {
      adjacency.get(edge.from)?.push(edge.to);
    }
  }

  const depth = new Map<string, number>();
  if (known.has(graph.start)) {
    depth.set(graph.start, 0);
    const queue = [graph.start];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const currentDepth = depth.get(current) as number;
      for (const next of adjacency.get(current) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, currentDepth + 1);
          queue.push(next);
        }
      }
    }
  }

  const maxDepth = depth.size > 0 ? Math.max(...depth.values()) : -1;
  const trailingColumn = maxDepth + 1;

  const rowsPerColumn = new Map<number, number>();
  const positions = new Map<string, Position>();
  for (const node of graph.nodes) {
    const column = depth.get(node.id) ?? trailingColumn;
    const row = rowsPerColumn.get(column) ?? 0;
    rowsPerColumn.set(column, row + 1);
    positions.set(node.id, { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT });
  }
  return positions;
}
