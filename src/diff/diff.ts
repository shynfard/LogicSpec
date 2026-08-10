import { buildGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";

export interface FieldChange {
  field: string;
  from?: string;
  to?: string;
}

export interface StepChange {
  id: string;
  changes: FieldChange[];
}

export interface EdgeRef {
  from: string;
  to: string;
  kind: string;
  label?: string;
}

/**
 * A semantic comparison of two feature versions. Buckets are deterministic:
 * additions follow the AFTER feature's source order, removals the BEFORE
 * feature's source order.
 */
export interface FeatureDiff {
  identical: boolean;
  startChanged?: { from: string; to: string };
  addedSteps: Array<{ id: string; type: string }>;
  removedSteps: Array<{ id: string; type: string }>;
  /** type/label/actor changes on steps present in both versions. */
  changedSteps: StepChange[];
  addedEdges: EdgeRef[];
  removedEdges: EdgeRef[];
  relabeledEdges: Array<{
    from: string;
    to: string;
    kind: string;
    labelFrom?: string;
    labelTo?: string;
  }>;
  addedActors: string[];
  removedActors: string[];
  addedContext: string[];
  removedContext: string[];
  addedOutcomes: string[];
  removedOutcomes: string[];
}

/**
 * Edges grouped by identity. Identity is `from|kind|to` — labels are
 * compared separately so a re-labeled transition reports as a relabel, not
 * as a remove+add. A group can hold several labels (e.g. two page actions
 * targeting the same step).
 */
interface EdgeGroup {
  from: string;
  to: string;
  kind: string;
  labels: Array<string | undefined>;
}

function groupEdges(feature: NormalizedFeature): Map<string, EdgeGroup> {
  const groups = new Map<string, EdgeGroup>();
  for (const edge of buildGraph(feature).edges) {
    const key = `${edge.from}|${edge.kind}|${edge.to}`;
    const existing = groups.get(key);
    if (existing) existing.labels.push(edge.label);
    else groups.set(key, { from: edge.from, to: edge.to, kind: edge.kind, labels: [edge.label] });
  }
  return groups;
}

function sortLabels(labels: readonly (string | undefined)[]): Array<string | undefined> {
  return [...labels].sort((a, b) => {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a.localeCompare(b);
  });
}

function edgeRef(
  group: { from: string; to: string; kind: string },
  label: string | undefined,
): EdgeRef {
  const ref: EdgeRef = { from: group.from, to: group.to, kind: group.kind };
  if (label !== undefined) ref.label = label;
  return ref;
}

function finalOutcomes(feature: NormalizedFeature): string[] {
  const outcomes = new Set<string>();
  for (const step of feature.steps) {
    if (step.def.type === "final") outcomes.add(step.def.outcome);
  }
  return [...outcomes].sort();
}

/** Compares two normalized features semantically (never textually). */
export function diffFeatures(before: NormalizedFeature, after: NormalizedFeature): FeatureDiff {
  const beforeSteps = new Map(before.steps.map((s) => [s.id, s]));
  const afterSteps = new Map(after.steps.map((s) => [s.id, s]));

  const addedSteps = after.steps
    .filter((s) => !beforeSteps.has(s.id))
    .map((s) => ({ id: s.id, type: s.type as string }));
  const removedSteps = before.steps
    .filter((s) => !afterSteps.has(s.id))
    .map((s) => ({ id: s.id, type: s.type as string }));

  const changedSteps: StepChange[] = [];
  for (const step of after.steps) {
    const prev = beforeSteps.get(step.id);
    if (!prev) continue;
    const changes: FieldChange[] = [];
    if (prev.type !== step.type) changes.push({ field: "type", from: prev.type, to: step.type });
    if (prev.label !== step.label)
      changes.push({ field: "label", from: prev.label, to: step.label });
    if (prev.actor !== step.actor)
      changes.push({ field: "actor", from: prev.actor, to: step.actor });
    if (changes.length > 0) changedSteps.push({ id: step.id, changes });
  }

  const beforeGroups = groupEdges(before);
  const afterGroups = groupEdges(after);
  const addedEdges: EdgeRef[] = [];
  const removedEdges: EdgeRef[] = [];
  const relabeledEdges: FeatureDiff["relabeledEdges"] = [];
  /** Surplus labels of shared groups, emitted later in BEFORE order. */
  const removedFromShared = new Map<string, EdgeRef[]>();

  for (const [key, group] of afterGroups) {
    const prev = beforeGroups.get(key);
    if (!prev) {
      for (const label of group.labels) addedEdges.push(edgeRef(group, label));
      continue;
    }
    // Cancel exact label matches; whatever remains changed on one side.
    const remainingBefore = [...prev.labels];
    const remainingAfter: Array<string | undefined> = [];
    for (const label of group.labels) {
      const index = remainingBefore.indexOf(label);
      if (index >= 0) remainingBefore.splice(index, 1);
      else remainingAfter.push(label);
    }
    const leftBefore = sortLabels(remainingBefore);
    const leftAfter = sortLabels(remainingAfter);
    const pairs = Math.min(leftBefore.length, leftAfter.length);
    for (let i = 0; i < pairs; i++) {
      relabeledEdges.push({
        from: group.from,
        to: group.to,
        kind: group.kind,
        labelFrom: leftBefore[i],
        labelTo: leftAfter[i],
      });
    }
    for (let i = pairs; i < leftAfter.length; i++) {
      addedEdges.push(edgeRef(group, leftAfter[i]));
    }
    if (leftBefore.length > pairs) {
      removedFromShared.set(
        key,
        leftBefore.slice(pairs).map((label) => edgeRef(prev, label)),
      );
    }
  }
  for (const [key, group] of beforeGroups) {
    if (!afterGroups.has(key)) {
      for (const label of group.labels) removedEdges.push(edgeRef(group, label));
    } else {
      const surplus = removedFromShared.get(key);
      if (surplus) removedEdges.push(...surplus);
    }
  }

  const beforeActors = before.actors.map((a) => a.id);
  const afterActors = after.actors.map((a) => a.id);
  const addedActors = afterActors.filter((id) => !beforeActors.includes(id));
  const removedActors = beforeActors.filter((id) => !afterActors.includes(id));

  const beforeContext = before.context.map((c) => c.name);
  const afterContext = after.context.map((c) => c.name);
  const addedContext = afterContext.filter((name) => !beforeContext.includes(name));
  const removedContext = beforeContext.filter((name) => !afterContext.includes(name));

  const beforeOutcomes = finalOutcomes(before);
  const afterOutcomes = finalOutcomes(after);
  const addedOutcomes = afterOutcomes.filter((o) => !beforeOutcomes.includes(o));
  const removedOutcomes = beforeOutcomes.filter((o) => !afterOutcomes.includes(o));

  const startChanged =
    before.start === after.start ? undefined : { from: before.start, to: after.start };

  const identical =
    startChanged === undefined &&
    addedSteps.length === 0 &&
    removedSteps.length === 0 &&
    changedSteps.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0 &&
    relabeledEdges.length === 0 &&
    addedActors.length === 0 &&
    removedActors.length === 0 &&
    addedContext.length === 0 &&
    removedContext.length === 0 &&
    addedOutcomes.length === 0 &&
    removedOutcomes.length === 0;

  return {
    identical,
    ...(startChanged ? { startChanged } : {}),
    addedSteps,
    removedSteps,
    changedSteps,
    addedEdges,
    removedEdges,
    relabeledEdges,
    addedActors,
    removedActors,
    addedContext,
    removedContext,
    addedOutcomes,
    removedOutcomes,
  };
}

function formatValue(value: string | undefined): string {
  return value === undefined ? "(none)" : `"${value}"`;
}

function formatEdge(edge: { from: string; to: string; kind: string; label?: string }): string {
  const label = edge.label === undefined ? "" : ` ("${edge.label}")`;
  return `${edge.from} -${edge.kind}-> ${edge.to}${label}`;
}

/** Renders a FeatureDiff as plain, uncolored text with +/-/~ markers. */
export function formatFeatureDiff(
  diff: FeatureDiff,
  beforeName: string,
  afterName: string,
): string {
  if (diff.identical) return "No semantic differences.\n";

  const lines: string[] = [`Diff: ${beforeName} → ${afterName}`, ""];

  if (diff.startChanged) {
    lines.push("Start:", `  ~ ${diff.startChanged.from} → ${diff.startChanged.to}`, "");
  }

  if (diff.addedSteps.length + diff.removedSteps.length + diff.changedSteps.length > 0) {
    lines.push("Steps:");
    for (const step of diff.addedSteps) lines.push(`  + ${step.id} (${step.type})`);
    for (const step of diff.removedSteps) lines.push(`  - ${step.id} (${step.type})`);
    for (const step of diff.changedSteps) {
      const changes = step.changes
        .map((c) => `${c.field} ${formatValue(c.from)} → ${formatValue(c.to)}`)
        .join(", ");
      lines.push(`  ~ ${step.id}: ${changes}`);
    }
    lines.push("");
  }

  if (diff.addedEdges.length + diff.removedEdges.length + diff.relabeledEdges.length > 0) {
    lines.push("Transitions:");
    for (const edge of diff.addedEdges) lines.push(`  + ${formatEdge(edge)}`);
    for (const edge of diff.removedEdges) lines.push(`  - ${formatEdge(edge)}`);
    for (const edge of diff.relabeledEdges) {
      lines.push(
        `  ~ ${edge.from} -${edge.kind}-> ${edge.to}: label ${formatValue(edge.labelFrom)} → ${formatValue(edge.labelTo)}`,
      );
    }
    lines.push("");
  }

  const inline = (title: string, added: readonly string[], removed: readonly string[]): void => {
    if (added.length + removed.length === 0) return;
    const parts = [...added.map((v) => `+${v}`), ...removed.map((v) => `-${v}`)];
    lines.push(`${title}: ${parts.join(" ")}`);
  };
  inline("Actors", diff.addedActors, diff.removedActors);
  inline("Context", diff.addedContext, diff.removedContext);
  inline("Outcomes", diff.addedOutcomes, diff.removedOutcomes);

  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}
