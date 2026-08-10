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
    expect(Object.keys(workspace.services?.services ?? {})).toEqual([
      "booking",
      "payment",
      "notification",
    ]);
    expect(Object.keys(workspace.events?.events ?? {})).toEqual([
      "BookingCreated",
      "PaymentCompleted",
    ]);
    expect(workspace.features.map((f) => f.id)).toEqual(["booking", "notify-booking"]);
    expect(workspace.knownFlows?.has("booking")).toBe(true);
    expect(workspace.knownFlows?.has("notify-booking")).toBe(true);
    expect(workspace.flowOutcomes?.get("notify-booking")).toEqual(new Set(["success", "failure"]));
  });

  it("loads referenced OpenAPI and AsyncAPI documents once each", () => {
    const workspace = loadWorkspace(BOOKING);
    expect(workspace.openApiDocuments.size).toBe(1);
    const openapi = [...workspace.openApiDocuments.values()][0];
    expect(openapi?.operationIds.has("reserveSlot")).toBe(true);
    expect(workspace.asyncApiDocuments.size).toBe(1);
    const asyncapi = [...workspace.asyncApiDocuments.values()][0];
    expect(asyncapi?.channels.has("booking.created")).toBe(true);
  });

  it("collects per-feature dependency info", () => {
    const workspace = loadWorkspace(BOOKING);
    const booking = workspace.features.find((f) => f.id === "booking");
    expect(booking?.publishes).toEqual(["BookingCreated"]);
    expect(booking?.services?.sort()).toEqual(["booking", "payment"]);
    const notify = workspace.features.find((f) => f.id === "notify-booking");
    expect(notify?.waitsFor).toEqual(["BookingCreated"]);
    expect(notify?.services).toEqual(["notification"]);
  });

  it("falls back to defaults without a config file", () => {
    const workspace = loadWorkspace(path.parse(ROOT).root);
    expect(workspace.configPath).toBeUndefined();
    expect(workspace.services).toBeUndefined();
    expect(workspace.knownFlows).toBeUndefined();
    expect(workspace.config.render.view).toBe("flow");
  });
});
