import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SUGGEST_BUDGET,
  resetSuggestBudget,
  suggest,
} from "../../src/diagnostics/suggest.js";

describe("suggest", () => {
  // The suggestion budget is module-level run state; give every case a full one.
  beforeEach(() => resetSuggestBudget());

  it("finds close matches", () => {
    expect(suggest("chekout", ["checkout", "select-time"])).toBe("checkout");
    expect(suggest("resreve-slot", ["reserve-slot", "create-booking"])).toBe("reserve-slot");
  });

  it("is case-insensitive", () => {
    expect(suggest("bookingcreatd", ["BookingCreated"])).toBe("BookingCreated");
  });

  it("returns undefined when nothing is close", () => {
    expect(suggest("zzz", ["checkout", "payment"])).toBeUndefined();
  });

  it("keeps a tight budget for short names", () => {
    expect(suggest("ab", ["xy"])).toBeUndefined();
    expect(suggest("ab", ["ac"])).toBe("ac");
  });

  it("returns no suggestion (quickly) for an over-long name — DoS guard", () => {
    const long = "x".repeat(5000);
    const candidates = Array.from({ length: 500 }, (_, i) => `step-${i}`);
    const started = Date.now();
    expect(suggest(long, candidates)).toBeUndefined();
    // Without the length guard this is O(n·m) and would hang; capped it is instant.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("skips over-long candidates rather than comparing against them", () => {
    expect(suggest("checkout", ["y".repeat(5000)])).toBeUndefined();
  });

  it("stops computing suggestions once the per-run budget is exhausted", () => {
    resetSuggestBudget(2);
    // The first two computations run normally and find the close match.
    expect(suggest("chekout", ["checkout"])).toBe("checkout");
    expect(suggest("chekout", ["checkout"])).toBe("checkout");
    // Budget spent: an identical would-be match now returns no suggestion, so a
    // hostile document's Nth unresolved reference costs nothing extra.
    expect(suggest("chekout", ["checkout"])).toBeUndefined();
    // A new validation pass restores the full budget.
    resetSuggestBudget();
    expect(suggest("chekout", ["checkout"])).toBe("checkout");
  });

  it("exposes a positive default budget large enough for normal specs", () => {
    expect(DEFAULT_SUGGEST_BUDGET).toBeGreaterThanOrEqual(200);
  });
});
