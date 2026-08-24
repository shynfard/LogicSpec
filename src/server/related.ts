import type { FeatureRecord } from "./data.js";

export interface RelatedFeatureRef {
  id: string;
  name: string;
  /** False when the reference does not resolve to a feature in this workspace. */
  known: boolean;
}

export interface RelatedEvent {
  event: string;
  /** "wait" = the other feature waits for an event this one publishes; "publish" = the reverse. */
  direction: "publish" | "wait";
  feature: RelatedFeatureRef;
}

export interface RelatedFeatures {
  subflows: RelatedFeatureRef[];
  dependents: RelatedFeatureRef[];
  events: RelatedEvent[];
}

function toRef(record: FeatureRecord): RelatedFeatureRef {
  return { id: record.id, name: record.name, known: true };
}

/**
 * Cross-feature relationships for one record: subflow targets it calls,
 * features that call it as a subflow, and features connected through a
 * shared event (one publishes what the other waits for).
 */
export function computeRelated(
  record: FeatureRecord,
  records: readonly FeatureRecord[],
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): RelatedFeatures {
  const byId = new Map(records.map((r) => [r.id, r]));
  const byPath = new Map(records.map((r) => [r.ref.path, r]));

  const subflows: RelatedFeatureRef[] = [...new Set(record.ref.flows)].map((flow) => {
    const target = byId.get(flow);
    return target !== undefined ? toRef(target) : { id: flow, name: flow, known: false };
  });

  const dependentPaths = dependents.get(record.ref.path) ?? new Set<string>();
  const dependentRefs: RelatedFeatureRef[] = [...dependentPaths]
    .map((p) => byPath.get(p))
    .filter((r): r is FeatureRecord => r !== undefined)
    .map(toRef);

  const events: RelatedEvent[] = [];
  for (const other of records) {
    if (other.id === record.id) continue;
    for (const name of record.ref.publishes) {
      if (other.ref.waitsFor.includes(name)) {
        events.push({ event: name, direction: "wait", feature: toRef(other) });
      }
    }
    for (const name of record.ref.waitsFor) {
      if (other.ref.publishes.includes(name)) {
        events.push({ event: name, direction: "publish", feature: toRef(other) });
      }
    }
  }
  events.sort((a, b) => a.event.localeCompare(b.event) || a.feature.id.localeCompare(b.feature.id));

  return { subflows, dependents: dependentRefs, events };
}
