import type { GraphNode } from "../graph/edges.js";
import type { EdgeKind } from "../graph/normalize.js";
import { type FinalOutcome, finalKind, type StepType } from "../schema/feature.js";

/**
 * Collapses every line-break form — `\n`, a bare `\r`, or a `\r\n` pair — to a
 * single space. Shared by every renderer that emits Mermaid text (quoted or
 * not), so a label can never inject a new Mermaid line (e.g. a `\r%%` payload
 * starting a comment on its own line). Single source of truth: renderers must
 * call this instead of rolling their own `\r?\n`-style regex, which would
 * leave a bare `\r` intact.
 */
export function normalizeMermaidNewlines(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, " ");
}

/**
 * Escapes user-provided text for use inside a quoted Mermaid label.
 * Mermaid entity codes keep the output safe in every renderer (GitHub,
 * VS Code, mermaid-cli) without depending on HTML escaping behavior.
 * `#` must be escaped first so entity codes we introduce stay intact.
 * `%` is neutralized (to `#37;`) so a `%%` in a label cannot open a Mermaid
 * comment and break that diagram line. Every line break — `\n`, a bare `\r`,
 * or a `\r\n` pair — collapses to a single space so a label can never inject a
 * new Mermaid line (e.g. a `\r%%` payload starting a comment on its own line).
 */
export function escapeMermaid(text: string): string {
  return normalizeMermaidNewlines(
    text
      .replaceAll("#", "#35;")
      .replaceAll("%", "#37;")
      .replaceAll("&", "#amp;")
      .replaceAll('"', "#quot;")
      .replaceAll("<", "#lt;")
      .replaceAll(">", "#gt;"),
  );
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

  /**
   * Sanitizes `base` to a syntactically inert candidate and returns the first
   * variant not already handed out, recording it as used. Shared by `id()` and
   * `reserve()` so every id — whether it maps a step or names a structural
   * construct — flows through the same collision-avoidance path.
   */
  private allocate(base: string): string {
    let candidate = base.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(candidate) || RESERVED.has(candidate.toLowerCase())) {
      candidate = `n_${candidate}`;
    }
    let unique = candidate;
    let counter = 2;
    while (this.used.has(unique)) {
      unique = `${candidate}_${counter}`;
      counter += 1;
    }
    this.used.add(unique);
    return unique;
  }

  id(stepId: string): string {
    const existing = this.assigned.get(stepId);
    if (existing !== undefined) return existing;
    const unique = this.allocate(stepId);
    this.assigned.set(stepId, unique);
    return unique;
  }

  /**
   * Reserves a unique id derived from `base` that is NOT bound to any step, so a
   * structural id (e.g. an agent-zone subgraph) can never collide with a step
   * whose id sanitizes to the same candidate — a step literally named `zone_0`
   * and the `zone_0` subgraph get distinct ids.
   */
  reserve(base: string): string {
    return this.allocate(base);
  }
}

/** Type marker shown under the label so shape is never the only signal. */
function typeMarker(node: GraphNode): string {
  if (node.type === "final") {
    const base = `FINAL · ${node.outcome ?? "success"}`;
    // Single canonical derivation of the normal/error/terminate distinction:
    // a terminated final wins the TERMINATE marker, a `failure` outcome reads
    // as an error terminal, everything else is a normal terminal.
    switch (
      finalKind({ outcome: (node.outcome ?? "success") as FinalOutcome, terminate: node.terminate })
    ) {
      case "terminate":
        return `${base} · ⦻ TERMINATE`;
      case "error":
        return `${base} · ⊗ ERROR`;
      default:
        return base;
    }
  }
  if (node.type === "event" && node.eventKind !== undefined) {
    return `EVENT · ${node.eventKind.toUpperCase()}`;
  }
  // A table-driven decision keeps the diamond shape but declares itself a table
  // and how many rules it holds, so the grid nature reads in the diagram.
  if (node.type === "decision" && node.decisionTable !== undefined) {
    const { hitPolicy, ruleCount } = node.decisionTable;
    const rules = `${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}`;
    return `DECISION TABLE · ${hitPolicy.toUpperCase()} · ${rules}`;
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
  // A refinement link renders as its own label line — documentation, never an
  // edge: the linked flow is not invoked, so it must not look like one.
  const detailsLine =
    node.details !== undefined && node.details.length > 0
      ? `<br/>${escapeMermaid(`» details: ${node.details.join(", ")}`)}`
      : "";
  const label = `${escapeMermaid(node.label)}<br/>${escapeMermaid(typeMarker(node))}${detailsLine}`;
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
