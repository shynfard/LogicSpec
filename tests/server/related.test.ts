import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatureRecords } from "../../src/server/data.js";
import { computeRelated } from "../../src/server/related.js";
import { featureDependents, loadWorkspace } from "../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");
const FULFILLMENT = path.join(ROOT, "examples", "fulfillment");

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

    expect(related.subflows).toEqual([
      { id: "nonexistent-flow", name: "nonexistent-flow", known: false },
    ]);
  });

  it("reports detail flows in both directions (fulfillment example)", () => {
    const workspace = loadWorkspace(FULFILLMENT);
    const records = loadFeatureRecords(workspace, FULFILLMENT);
    const dependents = featureDependents(workspace);

    const order = records.find((r) => r.id === "order-fulfillment");
    if (order === undefined) throw new Error("order-fulfillment record missing");
    const orderRelated = computeRelated(order, records, dependents);
    // checkout's `details: [send-email, send-sms]` — outgoing direction.
    expect(orderRelated.details.map((r) => r.id).sort()).toEqual(["send-email", "send-sms"]);
    expect(orderRelated.details.every((r) => r.known)).toBe(true);

    // Reverse search: send-email is cited as a detail flow by order-fulfillment.
    const sendEmail = records.find((r) => r.id === "send-email");
    if (sendEmail === undefined) throw new Error("send-email record missing");
    const emailRelated = computeRelated(sendEmail, records, dependents);
    expect(emailRelated.detailedIn.map((r) => r.id)).toEqual(["order-fulfillment"]);
  });

  it("marks an unresolvable detail flow as unknown", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const dependents = featureDependents(workspace);
    const booking = records.find((r) => r.id === "booking");
    if (booking === undefined) throw new Error("booking record missing");

    const fabricated = { ...booking, ref: { ...booking.ref, details: ["no-such-flow"] } };
    const related = computeRelated(fabricated, records, dependents);
    expect(related.details).toEqual([{ id: "no-such-flow", name: "no-such-flow", known: false }]);
  });
});
