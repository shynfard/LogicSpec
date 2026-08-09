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
});
