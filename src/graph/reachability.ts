import type { FeatureGraph } from "./edges.js";

export type Adjacency = ReadonlyMap<string, readonly string[]>;

export function forwardAdjacency(graph: FeatureGraph): Adjacency {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
  }
  return adj;
}

export function reverseAdjacency(graph: FeatureGraph): Adjacency {
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    // Edges to unknown targets are reported separately; skip them here.
    adj.get(edge.to)?.push(edge.from);
  }
  return adj;
}

/** Breadth-first closure over an adjacency map. */
export function closure(startIds: Iterable<string>, adjacency: Adjacency): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const id of startIds) {
    if (adjacency.has(id) && !seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const nextId of adjacency.get(current) ?? []) {
      if (!seen.has(nextId)) {
        seen.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return seen;
}

/**
 * Tarjan's strongly connected components, iterative to avoid stack limits.
 * Returns components in deterministic node order; every node appears once.
 */
export function stronglyConnectedComponents(graph: FeatureGraph): string[][] {
  const adjacency = forwardAdjacency(graph);
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  interface Frame {
    node: string;
    neighborIndex: number;
  }

  for (const start of graph.nodes.map((n) => n.id)) {
    if (index.has(start)) continue;

    const frames: Frame[] = [{ node: start, neighborIndex: 0 }];
    index.set(start, counter);
    lowlink.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1] as Frame;
      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.neighborIndex < neighbors.length) {
        const next = neighbors[frame.neighborIndex] as string;
        frame.neighborIndex += 1;
        if (!adjacency.has(next)) continue; // unknown target, reported elsewhere
        if (!index.has(next)) {
          index.set(next, counter);
          lowlink.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          frames.push({ node: next, neighborIndex: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(
            frame.node,
            Math.min(lowlink.get(frame.node) as number, index.get(next) as number),
          );
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        lowlink.set(
          parent.node,
          Math.min(lowlink.get(parent.node) as number, lowlink.get(frame.node) as number),
        );
      }
      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        while (true) {
          const popped = stack.pop() as string;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        components.push(component);
      }
    }
  }

  return components;
}

/** True when the component forms an actual cycle (size > 1 or a self-loop). */
export function componentHasCycle(component: readonly string[], graph: FeatureGraph): boolean {
  if (component.length > 1) return true;
  const only = component[0];
  return graph.edges.some((e) => e.from === only && e.to === only);
}
