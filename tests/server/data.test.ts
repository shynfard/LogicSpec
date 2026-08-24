import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findFeatureRecord, loadFeatureRecords } from "../../src/server/data.js";
import { loadWorkspace } from "../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("loadFeatureRecords", () => {
  it("loads and validates every feature in the booking workspace", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);

    expect(records.map((r) => r.id).sort()).toEqual(["booking", "notify-booking"]);
    const booking = findFeatureRecord(records, "booking");
    expect(booking?.name).toBe("Booking");
    expect(booking?.result.valid).toBe(true);
    expect(booking?.source).toContain("feature:");
    expect(booking?.result.stats?.steps).toBeGreaterThan(0);
  });

  it("findFeatureRecord returns undefined for an unknown id", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    expect(findFeatureRecord(records, "does-not-exist")).toBeUndefined();
  });
});
