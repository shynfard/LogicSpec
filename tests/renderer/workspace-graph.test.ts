import { describe, expect, it } from "vitest";
import {
  renderWorkspaceGraph,
  type WorkspaceFeatureSummary,
} from "../../src/renderers/workspace-graph.js";

const FEATURES: WorkspaceFeatureSummary[] = [
  {
    id: "booking",
    name: "Booking",
    subflows: ["payment-flow"],
    publishes: ["BookingCreated"],
    waitsFor: [],
    services: ["booking", "payment"],
  },
  {
    id: "notify",
    name: "Notify",
    subflows: [],
    publishes: [],
    waitsFor: ["BookingCreated"],
    services: ["notification"],
  },
];

describe("workspace graph renderer", () => {
  it("renders features, events and dangling subflow targets (golden)", () => {
    const first = renderWorkspaceGraph(FEATURES);
    expect(first).toBe(renderWorkspaceGraph(FEATURES));
    expect(first.startsWith("flowchart LR")).toBe(true);
    expect(first).toContain('feature_booking[["Booking<br/>FEATURE"]]');
    expect(first).toContain('feature_notify[["Notify<br/>FEATURE"]]');
    // Referenced but not present in the workspace: visible, marked FEATURE?.
    expect(first).toContain('feature_payment_flow["payment-flow<br/>FEATURE?"]');
    expect(first).toContain('feature_booking -- "subflow" --> feature_payment_flow');
    expect(first).toMatchSnapshot();
  });

  it("connects publishers and waiters through a single event node", () => {
    const output = renderWorkspaceGraph(FEATURES);
    const eventDeclarations = output
      .split("\n")
      .filter((line) => line.includes('>"BookingCreated<br/>EVENT"]'));
    expect(eventDeclarations).toHaveLength(1);
    expect(output).toContain("feature_booking -.-> event_BookingCreated");
    expect(output).toContain("event_BookingCreated -.-> feature_notify");
  });

  it("includes services only when asked", () => {
    const without = renderWorkspaceGraph(FEATURES);
    expect(without).not.toContain("SERVICE");

    const withServices = renderWorkspaceGraph(FEATURES, { includeServices: true });
    expect(withServices).toContain('service_booking[/"booking<br/>SERVICE"/]');
    expect(withServices).toContain('service_notification[/"notification<br/>SERVICE"/]');
    expect(withServices).toContain("feature_booking --> service_booking");
    expect(withServices).toContain("feature_notify --> service_notification");
  });

  it("honors the direction option", () => {
    expect(renderWorkspaceGraph(FEATURES, { direction: "TD" }).startsWith("flowchart TD")).toBe(
      true,
    );
  });

  it("dedupes repeated relationships", () => {
    const output = renderWorkspaceGraph([
      {
        id: "dup",
        name: "Dup",
        subflows: [],
        publishes: ["BookingCreated", "BookingCreated"],
        waitsFor: [],
        services: [],
      },
    ]);
    const edges = output
      .split("\n")
      .filter((line) => line.trim() === "feature_dup -.-> event_BookingCreated");
    expect(edges).toHaveLength(1);
  });
});
