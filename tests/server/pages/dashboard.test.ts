import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatureRecords } from "../../../src/server/data.js";
import { renderDashboardPage } from "../../../src/server/pages/dashboard.js";
import { loadWorkspace } from "../../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("renderDashboardPage", () => {
  it("lists every feature as a linked, badged card", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const html = renderDashboardPage(records);

    expect(html).toContain('href="/features/booking"');
    expect(html).toContain('href="/features/notify-booking"');
    expect(html).toContain("Booking");
    expect(html).toContain("Booking Notification");
    expect(html).toContain("step");
  });

  it("renders a friendly message with no features", () => {
    expect(renderDashboardPage([])).toContain("No features found");
  });
});
