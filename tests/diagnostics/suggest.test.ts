import { describe, expect, it } from "vitest";
import { suggest } from "../../src/diagnostics/suggest.js";

describe("suggest", () => {
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
});
