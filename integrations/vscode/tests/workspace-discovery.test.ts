import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  discoverWorkspaceRoots,
  nearestWorkspaceRoot,
  resolveWorkspaceStartDir,
} from "../src/workspace-discovery.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EXAMPLES = path.join(REPO, "examples");

describe("discoverWorkspaceRoots", () => {
  it("finds every nested example workspace below a config-less root", () => {
    const roots = discoverWorkspaceRoots(EXAMPLES);
    const names = roots.map((dir: string) => path.basename(dir)).sort();
    expect(names).toEqual(["booking", "fulfillment", "pricing", "reminders", "shared", "triage"]);
  });

  it("returns the directory itself when it is a workspace", () => {
    const booking = path.join(EXAMPLES, "booking");
    expect(discoverWorkspaceRoots(booking)).toEqual([booking]);
  });
});

describe("nearestWorkspaceRoot", () => {
  it("walks up from a feature file's directory to its workspace", () => {
    const fulfillment = path.join(EXAMPLES, "fulfillment");
    expect(nearestWorkspaceRoot(fulfillment)).toBe(fulfillment);
  });

  it("returns undefined when nothing above carries a config", () => {
    expect(nearestWorkspaceRoot(path.join(REPO, "src"))).toBeUndefined();
  });
});

describe("resolveWorkspaceStartDir", () => {
  it("prefers the workspace surrounding the active file", () => {
    const file = path.join(EXAMPLES, "fulfillment", "order-fulfillment.feature.yaml");
    const resolution = resolveWorkspaceStartDir(file, REPO);
    expect(resolution.dir).toBe(path.join(EXAMPLES, "fulfillment"));
  });

  it("offers all discovered workspaces as candidates for a config-less folder", () => {
    // Active file outside any workspace (the repo README) → fall through to
    // discovery; the repo root holds six example workspaces → picker.
    const resolution = resolveWorkspaceStartDir(path.join(REPO, "README.md"), EXAMPLES);
    expect(resolution.dir).toBeUndefined();
    expect(resolution.candidates?.length).toBe(6);
  });

  it("resolves unambiguously when exactly one workspace exists below", () => {
    const resolution = resolveWorkspaceStartDir(undefined, path.join(EXAMPLES, "pricing"));
    expect(resolution.dir).toBe(path.join(EXAMPLES, "pricing"));
  });

  it("reports no candidates when there is nothing anywhere", () => {
    const resolution = resolveWorkspaceStartDir(undefined, undefined);
    expect(resolution.dir).toBeUndefined();
    expect(resolution.candidates).toEqual([]);
  });
});
