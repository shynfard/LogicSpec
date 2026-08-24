import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findFeatureRecord, loadFeatureRecords } from "../../../src/server/data.js";
import { renderFeatureDetailPage } from "../../../src/server/pages/feature-detail.js";
import { computeRelated } from "../../../src/server/related.js";
import { featureDependents, loadWorkspace } from "../../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKING = path.join(ROOT, "examples", "booking");

function bookingRecord() {
  const workspace = loadWorkspace(BOOKING);
  const records = loadFeatureRecords(workspace, BOOKING);
  const booking = findFeatureRecord(records, "booking");
  if (booking === undefined) throw new Error("booking record missing");
  return { workspace, records, booking };
}

describe("renderFeatureDetailPage", () => {
  it("renders every tab for a valid feature", () => {
    const { workspace, records, booking } = bookingRecord();
    const related = computeRelated(booking, records, featureDependents(workspace));

    const html = renderFeatureDetailPage(booking, related);

    expect(html).toContain(`<title>LogicSpec: ${booking.name}`);
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-tab="diagnostics"');
    expect(html).toContain('data-tab="related"');
    expect(html).toContain("notify-booking");
    for (const step of booking.result.normalized?.steps ?? []) {
      expect(html).toContain(`id="step-${step.id}"`);
    }
  });

  it("shows an invalid-spec fallback instead of crashing when the feature is broken", () => {
    const { workspace, records, booking } = bookingRecord();
    const broken = {
      ...booking,
      result: { valid: false, diagnostics: booking.result.diagnostics },
    };
    const related = computeRelated(broken, records, featureDependents(workspace));
    const html = renderFeatureDetailPage(broken, related);
    expect(html).toContain("Spec is invalid");
    expect(html).not.toContain('class="mermaid"');
  });

  it("escapes YAML-derived content instead of injecting markup", () => {
    const { workspace, records, booking } = bookingRecord();
    const normalized = booking.result.normalized;
    if (normalized === undefined) throw new Error("expected a normalized model");
    const tampered = {
      ...booking,
      result: {
        ...booking.result,
        normalized: {
          ...normalized,
          steps: normalized.steps.map((s, i) =>
            i === 0 ? { ...s, label: "<img src=x onerror=alert(1)>" } : s,
          ),
        },
      },
    };
    const related = computeRelated(tampered, records, featureDependents(workspace));
    const html = renderFeatureDetailPage(tampered, related);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
