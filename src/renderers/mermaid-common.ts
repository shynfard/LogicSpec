import type { GraphNode } from "../graph/edges.js";
import type { EdgeKind } from "../graph/normalize.js";
import type { StepType } from "../schema/feature.js";

/**
 * Escapes user-provided text for use inside a quoted Mermaid label.
 * Mermaid entity codes keep the output safe in every renderer (GitHub,
 * VS Code, mermaid-cli) without depending on HTML escaping behavior.
 * `#` must be escaped first so entity codes we introduce stay intact.
 */
export function escapeMermaid(text: string): string {
  return text
    .replaceAll("#", "#35;")
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("\n", " ");
}

/** Words Mermaid treats specially; never emit them as bare node ids. */
const RESERVED = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "style",
  "classdef",
  "class",
  "click",
  "direction",
  "linkstyle",
]);

/**
 * Maps step ids to safe, stable Mermaid node ids. Display labels are always
 * quoted separately, so ids only need to be syntactically inert.
 */
export class NodeIdAllocator {
  private readonly assigned = new Map<string, string>();
  private readonly used = new Set<string>();

  id(stepId: string): string {
    const existing = this.assigned.get(stepId);
    if (existing !== undefined) return existing;

    let candidate = stepId.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(candidate) || RESERVED.has(candidate.toLowerCase())) {
      candidate = `n_${candidate}`;
    }
    let unique = candidate;
    let counter = 2;
    while (this.used.has(unique)) {
      unique = `${candidate}_${counter}`;
      counter += 1;
    }
    this.assigned.set(stepId, unique);
    this.used.add(unique);
    return unique;
  }
}

/** Type marker shown under the label so shape is never the only signal. */
function typeMarker(node: GraphNode): string {
  if (node.type === "final") {
    const base = `FINAL · ${node.outcome ?? "success"}`;
    return node.terminate === true ? `${base} · ⦻ TERMINATE` : base;
  }
  if (node.type === "event" && node.eventKind !== undefined) {
    return `EVENT · ${node.eventKind.toUpperCase()}`;
  }
  return node.type.toUpperCase();
}

/**
 * Renders one node declaration with a type-specific shape:
 * page → rectangle, decision → diamond, operation/subflow → subroutine,
 * event → flag, wait → stadium, parallel → parallelogram, error → rectangle
 * (marked), final → double circle.
 */
export function nodeDeclaration(node: GraphNode, mermaidId: string): string {
  const label = `${escapeMermaid(node.label)}<br/>${escapeMermaid(typeMarker(node))}`;
  switch (node.type) {
    case "page":
      return `${mermaidId}["${label}"]`;
    case "decision":
      return `${mermaidId}{"${label}"}`;
    case "operation":
    case "subflow":
      return `${mermaidId}[["${label}"]]`;
    case "event":
      return `${mermaidId}>"${label}"]`;
    case "wait":
      return `${mermaidId}(["${label}"])`;
    case "parallel":
      return `${mermaidId}[/"${label}"/]`;
    case "error":
      return `${mermaidId}["${label}"]:::error`;
    case "final":
      return `${mermaidId}((("${label}")))`;
  }
}

/**
 * Composes an edge's display text from its label and optional guard.
 * A guard renders as a bracketed `[when: …]` suffix so it reads distinctly
 * from the outcome/action label.
 */
export function edgeLabel(label: string | undefined, guard?: string): string | undefined {
  const parts: string[] = [];
  if (label !== undefined && label !== "") parts.push(label);
  if (guard !== undefined && guard !== "") parts.push(`[when: ${guard}]`);
  return parts.length === 0 ? undefined : parts.join(" ");
}

/** Async edges (event waits) render dotted; everything else solid. */
export function edgeArrow(kind: EdgeKind, label: string | undefined, guard?: string): string {
  const dotted = kind === "event";
  const text = edgeLabel(label, guard);
  if (text === undefined) {
    return dotted ? "-.->" : "-->";
  }
  const escaped = escapeMermaid(text);
  return dotted ? `-. "${escaped}" .->` : `-- "${escaped}" -->`;
}

export const START_NODE_ID = "START";

export function startDeclaration(): string {
  return `${START_NODE_ID}(("Start"))`;
}

/** Shared, theme-neutral class definitions (shapes carry the meaning). */
export const CLASS_DEFS = ["classDef error stroke-width:2px,stroke-dasharray:4 3;"];

/**
 * Mermaid node id → step id for a feature graph, matching the allocation the
 * flowchart renderer performs. Used by interactive hosts (e.g. the VS Code
 * preview) to map diagram clicks back to YAML steps.
 *
 * Caveat: allocation is order-sensitive only when two step ids sanitize to
 * the same candidate (collision suffixes); for such pathological ids the
 * swimlane/event-model views may disagree on the suffixed entries.
 */
export function mermaidNodeIdMap(graph: {
  nodes: ReadonlyArray<{ id: string }>;
}): Map<string, string> {
  const ids = new NodeIdAllocator();
  const map = new Map<string, string>();
  for (const node of graph.nodes) {
    map.set(ids.id(node.id), node.id);
  }
  return map;
}

export type { StepType };
