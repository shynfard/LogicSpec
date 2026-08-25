import { describe, expect, it } from "vitest";
import { parseSseData } from "../../client/src/lib/liveReload.js";

describe("parseSseData", () => {
  it("extracts the data payload from one SSE frame", () => {
    expect(parseSseData("data: reload\n\n")).toBe("reload");
  });

  it("returns undefined for a frame with no data line", () => {
    expect(parseSseData("\n")).toBeUndefined();
  });
});
