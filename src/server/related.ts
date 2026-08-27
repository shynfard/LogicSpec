import { featureStem } from "../workspace/loader.js";
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
  /** Flows this feature's steps reference via `details` (refinement docs). */
  details: RelatedFeatureRef[];
  /** Features whose steps reference THIS feature via `details`. */
  detailedIn: RelatedFeatureRef[];
  events: RelatedEvent[];
}

function toRef(record: FeatureRecord): RelatedFeatureRef {
  return { id: record.id, name: record.name, known: true };
}

/**
 * Cross-feature relationships for one record: subflow targets it calls,
 * features that call it as a subflow, detail flows referenced by its steps
 * (and the reverse — features whose steps cite this one as a detail flow),
 * and features connected through a shared event (one publishes what the
 * other waits for).
 */
export function computeRelated(
  record: FeatureRecord,
  records: readonly FeatureRecord[],
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): RelatedFeatures {
  const byId = new Map(records.map((r) => [r.id, r]));
  const byPath = new Map(records.map((r) => [r.ref.path, r]));
  // Flow references resolve by feature id OR file stem — same rule as
  // subflow resolution in the validator.
  const byStem = new Map(records.map((r) => [featureStem(r.ref.path), r]));
  const resolveFlow = (flow: string): FeatureRecord | undefined =>
    byId.get(flow) ?? byStem.get(flow);

  const subflows: RelatedFeatureRef[] = [...new Set(record.ref.flows)].map((flow) => {
    const target = byId.get(flow);
    return target !== undefined ? toRef(target) : { id: flow, name: flow, known: false };
  });

  const dependentPaths = dependents.get(record.ref.path) ?? new Set<string>();
  const dependentRefs: RelatedFeatureRef[] = [...dependentPaths]
    .map((p) => byPath.get(p))
    .filter((r): r is FeatureRecord => r !== undefined)
    .map(toRef);

  const details: RelatedFeatureRef[] = [...new Set(record.ref.details)].map((flow) => {
    const target = resolveFlow(flow);
    return target !== undefined ? toRef(target) : { id: flow, name: flow, known: false };
  });

  const ownNames = new Set([record.id, featureStem(record.ref.path)]);
  const detailedIn: RelatedFeatureRef[] = records
    .filter(
      (other) => other.id !== record.id && other.ref.details.some((flow) => ownNames.has(flow)),
    )
    .map(toRef)
    .sort((a, b) => a.id.localeCompare(b.id));

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

  return { subflows, dependents: dependentRefs, details, detailedIn, events };
}
