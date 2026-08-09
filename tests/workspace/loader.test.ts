import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("loadWorkspace", () => {
  it("loads the booking example workspace with catalogs and features", () => {
    const workspace = loadWorkspace(BOOKING);
    expect(workspace.configPath).toBe(path.join(BOOKING, "logicspec.config.yaml"));
    expect(workspace.diagnostics).toEqual([]);
    expect(Object.keys(workspace.services?.services ?? {})).toEqual(["booking", "payment"]);
    expect(Object.keys(workspace.events?.events ?? {})).toEqual([
      "BookingCreated",
      "PaymentCompleted",
    ]);
    expect(workspace.features.map((f) => f.id)).toEqual(["booking"]);
    expect(workspace.knownFlows?.has("booking")).toBe(true);
  });

  it("falls back to defaults without a config file", () => {
    const workspace = loadWorkspace(path.parse(ROOT).root);
    expect(workspace.configPath).toBeUndefined();
    expect(workspace.services).toBeUndefined();
    expect(workspace.knownFlows).toBeUndefined();
    expect(workspace.config.render.view).toBe("flow");
  });
});
