import type { RenderDirection } from "../schema/config.js";
import { edgeArrow, escapeMermaid, NodeIdAllocator } from "./mermaid-common.js";

/** One feature's cross-feature relationships, precomputed by the caller. */
export interface WorkspaceFeatureSummary {
  id: string;
  name: string;
  /** Feature ids/stems referenced via subflow steps and parallel branches. */
  subflows: string[];
  /** Event names published by the feature. */
  publishes: string[];
  /** Event names the feature waits for. */
  waitsFor: string[];
  /** Service ids called by the feature. */
  services: string[];
}

export interface WorkspaceGraphOptions {
  includeServices?: boolean;
  direction?: RenderDirection;
}

/**
 * Renders the workspace-level dependency graph: features connected through
 * subflow references and through the events they publish or wait for, with
 * optional service dependencies.
 *
 * Deterministic: features in the caller-given order, events and services
 * sorted by name, duplicate edges collapsed. A subflow target that is not in
 * the feature list still gets a node (marked `FEATURE?`) so dangling
 * references stay visible.
 *
 * Node aliases are namespaced (`feature:`/`event:`/`service:`) before
 * sanitizing so a feature, an event and a service sharing a name never
 * collapse into one node.
 */
export function renderWorkspaceGraph(
  features: readonly WorkspaceFeatureSummary[],
  options: WorkspaceGraphOptions = {},
): string {
  const direction = options.direction ?? "LR";
  const includeServices = options.includeServices ?? false;
  const ids = new NodeIdAllocator();
  const lines: string[] = [`flowchart ${direction}`];

  const featureAlias = (id: string): string => ids.id(`feature:${id}`);
  const eventAlias = (name: string): string => ids.id(`event:${name}`);
  const serviceAlias = (id: string): string => ids.id(`service:${id}`);

  const knownIds = new Set(features.map((f) => f.id));
  for (const feature of features) {
    lines.push(`  ${featureAlias(feature.id)}[["${escapeMermaid(feature.name)}<br/>FEATURE"]]`);
  }

  const missingTargets: string[] = [];
  for (const feature of features) {
    for (const target of feature.subflows) {
      if (!knownIds.has(target) && !missingTargets.includes(target)) missingTargets.push(target);
    }
  }
  for (const target of missingTargets) {
    lines.push(`  ${featureAlias(target)}["${escapeMermaid(target)}<br/>FEATURE?"]`);
  }

  const events = [...new Set(features.flatMap((f) => [...f.publishes, ...f.waitsFor]))].sort();
  for (const name of events) {
    lines.push(`  ${eventAlias(name)}>"${escapeMermaid(name)}<br/>EVENT"]`);
  }

  if (includeServices) {
    const services = [...new Set(features.flatMap((f) => f.services))].sort();
    for (const id of services) {
      lines.push(`  ${serviceAlias(id)}[/"${escapeMermaid(id)}<br/>SERVICE"/]`);
    }
  }

  lines.push("");
  const seen = new Set<string>();
  const pushEdge = (line: string): void => {
    if (seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };
  for (const feature of features) {
    for (const target of feature.subflows) {
      pushEdge(
        `  ${featureAlias(feature.id)} ${edgeArrow("next", "subflow")} ${featureAlias(target)}`,
      );
    }
    for (const name of feature.publishes) {
      pushEdge(
        `  ${featureAlias(feature.id)} ${edgeArrow("event", undefined)} ${eventAlias(name)}`,
      );
    }
    for (const name of feature.waitsFor) {
      pushEdge(
        `  ${eventAlias(name)} ${edgeArrow("event", undefined)} ${featureAlias(feature.id)}`,
      );
    }
    if (includeServices) {
      for (const id of feature.services) {
        pushEdge(`  ${featureAlias(feature.id)} --> ${serviceAlias(id)}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Mermaid node id → feature id for the workspace graph's feature nodes,
 * matching renderWorkspaceGraph's allocation (`feature:<id>` namespace,
 * features first, in the given order). Interactive hosts use this to open
 * the clicked feature's file.
 */
export function workspaceGraphNodeIdMap(
  features: ReadonlyArray<Pick<WorkspaceFeatureSummary, "id">>,
): Map<string, string> {
  const ids = new NodeIdAllocator();
  const map = new Map<string, string>();
  for (const feature of features) {
    map.set(ids.id(`feature:${feature.id}`), feature.id);
  }
  return map;
}
