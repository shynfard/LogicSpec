import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatureRecords } from "../../src/server/data.js";
import { computeRelated } from "../../src/server/related.js";
import { featureDependents, loadWorkspace } from "../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("computeRelated", () => {
  it("links booking and notify-booking through the BookingCreated event", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const dependents = featureDependents(workspace);

    const booking = records.find((r) => r.id === "booking");
    if (booking === undefined) throw new Error("booking record missing");
    const related = computeRelated(booking, records, dependents);

    expect(related.events).toContainEqual({
      event: "BookingCreated",
      direction: "wait",
      feature: { id: "notify-booking", name: "Booking Notification", known: true },
    });
  });

  it("marks a subflow target with no matching feature as unknown", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const dependents = featureDependents(workspace);
    const booking = records.find((r) => r.id === "booking");
    if (booking === undefined) throw new Error("booking record missing");

    const fabricated = { ...booking, ref: { ...booking.ref, flows: ["nonexistent-flow"] } };
    const related = computeRelated(fabricated, records, dependents);

    expect(related.subflows).toEqual([{ id: "nonexistent-flow", name: "nonexistent-flow", known: false }]);
  });
});
