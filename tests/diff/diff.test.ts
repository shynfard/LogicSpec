import { describe, expect, it } from "vitest";
import { diffFeatures, formatFeatureDiff } from "../../src/diff/diff.js";
import { type NormalizedFeature, normalizeFeature, parseFeature } from "../../src/index.js";

function normOf(source: string): NormalizedFeature {
  const parsed = parseFeature(source);
  if (!parsed.data) throw new Error(`fixture must parse: ${JSON.stringify(parsed.diagnostics)}`);
  return normalizeFeature(parsed.data);
}

const BEFORE = normOf(`
version: "1"
feature: { id: d, name: Diff }
start: home
actors:
  web: { kind: frontend }
  legacy: { kind: service }
context:
  a: { type: string }
steps:
  home:
    type: page
    label: Home
    actor: web
    actions:
      go: { label: Go, next: work }
      side: { next: extra }
  work:
    type: operation
    label: Work
    next: fin
  extra:
    type: page
    actions:
      back: { next: home }
  fin:
    type: final
    outcome: success
`);

const AFTER = normOf(`
version: "1"
feature: { id: d, name: Diff }
start: work
actors:
  web: { kind: frontend }
  api: { kind: service }
context:
  a: { type: string }
  b: { type: string }
steps:
  home:
    type: page
    label: Homepage
    actor: web
    actions:
      go: { label: Go!, next: work }
      side: { next: added }
  work:
    type: operation
    label: Work
    actor: api
    next: fin
  added:
    type: page
    actions:
      back: { next: home }
  fin:
    type: final
    outcome: failure
`);

describe("diffFeatures", () => {
  const diff = diffFeatures(BEFORE, AFTER);

  it("detects start, step, actor, context and outcome changes", () => {
    expect(diff.identical).toBe(false);
    expect(diff.startChanged).toEqual({ from: "home", to: "work" });
    expect(diff.addedSteps).toEqual([{ id: "added", type: "page" }]);
    expect(diff.removedSteps).toEqual([{ id: "extra", type: "page" }]);
    expect(diff.changedSteps).toEqual([
      { id: "home", changes: [{ field: "label", from: "Home", to: "Homepage" }] },
      { id: "work", changes: [{ field: "actor", from: undefined, to: "api" }] },
    ]);
    expect(diff.addedActors).toEqual(["api"]);
    expect(diff.removedActors).toEqual(["legacy"]);
    expect(diff.addedContext).toEqual(["b"]);
    expect(diff.removedContext).toEqual([]);
    expect(diff.addedOutcomes).toEqual(["failure"]);
    expect(diff.removedOutcomes).toEqual(["success"]);
  });

  it("classifies edges as added, removed or relabeled by identity", () => {
    // side retargeted extra → added; extra's back edge went with the step.
    expect(diff.addedEdges).toEqual([
      { from: "home", to: "added", kind: "action", label: "side" },
      { from: "added", to: "home", kind: "action", label: "back" },
    ]);
    expect(diff.removedEdges).toEqual([
      { from: "home", to: "extra", kind: "action", label: "side" },
      { from: "extra", to: "home", kind: "action", label: "back" },
    ]);
    // Same from|kind|to with a different label is a relabel, not add+remove.
    expect(diff.relabeledEdges).toEqual([
      { from: "home", to: "work", kind: "action", labelFrom: "Go", labelTo: "Go!" },
    ]);
  });

  it("reports identical features as identical", () => {
    const same = diffFeatures(BEFORE, BEFORE);
    expect(same.identical).toBe(true);
    expect(same.startChanged).toBeUndefined();
    expect(formatFeatureDiff(same, "a", "b")).toContain("No semantic differences.");
  });

  it("formats a readable report", () => {
    const text = formatFeatureDiff(diff, "before.feature.yaml", "after.feature.yaml");
    expect(text).toContain("Diff: before.feature.yaml → after.feature.yaml");
    expect(text).toContain("~ home → work");
    expect(text).toContain("+ added (page)");
    expect(text).toContain("- extra (page)");
    expect(text).toContain('~ home: label "Home" → "Homepage"');
    expect(text).toContain('~ work: actor (none) → "api"');
    expect(text).toContain('+ home -action-> added ("side")');
    expect(text).toContain('~ home -action-> work: label "Go" → "Go!"');
    expect(text).toContain("Actors: +api -legacy");
    expect(text).toContain("Context: +b");
    expect(text).toContain("Outcomes: +failure -success");
  });

  it("handles parallel actions to the same target as a multiset", () => {
    const twoBefore = normOf(`
version: "1"
feature: { id: m, name: Multi }
start: home
steps:
  home:
    type: page
    actions:
      select: { label: Select, next: fin }
      any: { label: Any, next: fin }
  fin:
    type: final
    outcome: success
`);
    const twoAfter = normOf(`
version: "1"
feature: { id: m, name: Multi }
start: home
steps:
  home:
    type: page
    actions:
      select: { label: Select, next: fin }
      any: { label: Any staff, next: fin }
  fin:
    type: final
    outcome: success
`);
    const multi = diffFeatures(twoBefore, twoAfter);
    expect(multi.addedEdges).toEqual([]);
    expect(multi.removedEdges).toEqual([]);
    expect(multi.relabeledEdges).toEqual([
      { from: "home", to: "fin", kind: "action", labelFrom: "Any", labelTo: "Any staff" },
    ]);
  });
});
