import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../../src/workspace/loader.js";
import { watchTargetsFor } from "../../src/workspace/watch.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("watchTargetsFor", () => {
  it("includes the features directory, config, and configured catalogs", () => {
    const workspace = loadWorkspace(BOOKING);
    const targets = watchTargetsFor(workspace, BOOKING);

    expect(targets).toContain(path.join(BOOKING, "logicspec.config.yaml"));
    expect(targets).toContain(path.join(BOOKING, "services.yaml"));
    expect(targets).toContain(path.join(BOOKING, "events.yaml"));
    expect(targets.some((t) => t === BOOKING)).toBe(true);
  });

  it("falls back to startDir alone without a config", () => {
    const workspace = loadWorkspace(ROOT); // repo root has no logicspec.config.yaml
    const targets = watchTargetsFor(workspace, ROOT);
    expect(targets).toEqual([ROOT]);
  });
});
