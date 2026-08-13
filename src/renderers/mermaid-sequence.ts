import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature, NormalizedStep } from "../graph/normalize.js";
import type { EventStep } from "../schema/feature.js";
import {
  edgeLabel,
  escapeMermaid,
  NodeIdAllocator,
  normalizeMermaidNewlines,
} from "./mermaid-common.js";

/** Human-readable description of an event step for a sequence-diagram note. */
function eventNote(def: EventStep): string {
  switch (def.eventKind) {
    case "timer": {
      const spec = def.after
        ? `after ${def.after}`
        : def.at
          ? `at ${def.at}`
          : def.every
            ? `every ${def.every}`
            : "";
      return `timer${spec ? ` ${spec}` : ""}`;
    }
    case "error":
      return `error${def.name ? ` ${def.name}` : ""}`;
    case "conditional":
      return `condition${def.when ? ` ${def.when}` : ""}`;
    default: {
      const verb = def.direction === "publish" ? "publishes" : "waits for";
      return `${verb} ${def.event ?? "(event)"}`;
    }
  }
}

/**
 * Allocator key for the pseudo-participant that owns steps without an actor.
 * The leading space keeps it from ever colliding with a real actor id
 * (identifiers must start with a letter).
 */
const UNASSIGNED_KEY = " unassigned";
const UNASSIGNED_LABEL = "Unassigned";

/**
 * Participant display names are emitted unquoted, so the sequence-statement
 * delimiters (`:` between alias and message, `;` as line separator) must not
 * appear in them. Newlines (including a bare `\r`, which a naive `\r?\n`
 * regex would miss) are normalized through the shared helper so a `\r%%`
 * payload can never break out onto its own Mermaid line here either.
 */
function participantDisplay(label: string): string {
  return normalizeMermaidNewlines(label).replaceAll(";", ",").replaceAll(":", "-");
}

/**
 * Message and note text: replace `;` (a Mermaid statement separator even
 * mid-line) before entity-escaping — escaping afterwards would corrupt the
 * `#quot;`-style entities the escaper introduces.
 */
function sequenceText(text: string): string {
  return escapeMermaid(text.replaceAll(";", ","));
}

/**
 * EXPERIMENTAL: renders the feature as a Mermaid sequence diagram.
 *
 * This is an interaction map, not a temporal trace: a branching flow has no
 * single linear timeline, so every transition becomes one message from the
 * actor of its source step to the actor of its target step, in source order.
 * Event waits render as dotted (async) arrows; waits and event steps carry
 * explanatory notes.
 */
export function renderMermaidSequence(feature: NormalizedFeature, graph: FeatureGraph): string {
  const ids = new NodeIdAllocator();
  const lines: string[] = ["sequenceDiagram"];

  const stepById = new Map(feature.steps.map((s) => [s.id, s]));
  const usedActorIds = new Set<string>();
  let hasUnassigned = false;
  for (const step of feature.steps) {
    if (step.actor === undefined) hasUnassigned = true;
    else usedActorIds.add(step.actor);
  }

  const declaredIds = new Set(feature.actors.map((a) => a.id));
  const participants: Array<{ key: string; display: string }> = [];
  for (const actor of feature.actors) {
    if (usedActorIds.has(actor.id)) participants.push({ key: actor.id, display: actor.label });
  }
  // Steps may reference undeclared actors (a semantic error, but renderers
  // must stay robust): give them a participant in first-reference order.
  for (const step of feature.steps) {
    if (
      step.actor !== undefined &&
      !declaredIds.has(step.actor) &&
      !participants.some((p) => p.key === step.actor)
    ) {
      participants.push({ key: step.actor, display: step.actor });
    }
  }
  if (hasUnassigned) participants.push({ key: UNASSIGNED_KEY, display: UNASSIGNED_LABEL });

  for (const participant of participants) {
    lines.push(
      `  participant ${ids.id(participant.key)} as ${participantDisplay(participant.display)}`,
    );
  }

  const aliasFor = (step: NormalizedStep): string =>
    step.actor === undefined ? ids.id(UNASSIGNED_KEY) : ids.id(step.actor);

  if (participants.length > 0) lines.push("");
  const known = new Set(graph.nodes.map((n) => n.id));

  for (const step of feature.steps) {
    const def = step.def;
    if (def.type === "wait") {
      lines.push(`  Note over ${aliasFor(step)}: waits ${sequenceText(def.duration)}`);
    }
    if (def.type === "event") {
      lines.push(`  Note over ${aliasFor(step)}: ${sequenceText(eventNote(def))}`);
    }
    for (const transition of step.transitions) {
      const target = stepById.get(transition.to);
      if (target === undefined || !known.has(transition.to)) continue;
      const arrow = transition.kind === "event" ? "--)" : "->>";
      const text = edgeLabel(transition.label ?? target.label, transition.guard) ?? target.label;
      lines.push(`  ${aliasFor(step)}${arrow}${aliasFor(target)}: ${sequenceText(text)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
