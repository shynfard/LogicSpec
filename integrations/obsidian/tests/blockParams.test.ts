import { describe, expect, it } from "vitest";
import { parseFileBlock } from "../src/blockParams.js";

describe("parseFileBlock", () => {
  it("parses a minimal block", () => {
    const parsed = parseFileBlock("file: features/booking.feature.yaml\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.params).toEqual({
      file: "features/booking.feature.yaml",
      view: undefined,
      direction: undefined,
    });
  });

  it("parses view and direction overrides", () => {
    const parsed = parseFileBlock(
      "file: flows/x.feature.yaml\nview: swimlane\ndirection: LR\n",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.params?.view).toBe("swimlane");
    expect(parsed.params?.direction).toBe("LR");
  });

  it("requires the file key", () => {
    const parsed = parseFileBlock("view: flow\n");
    expect(parsed.params).toBeUndefined();
    expect(parsed.errors.some((e) => e.includes('"file"'))).toBe(true);
  });

  it("rejects unknown keys", () => {
    const parsed = parseFileBlock("file: a.feature.yaml\ntheme: dark\n");
    expect(parsed.params).toBeUndefined();
    expect(parsed.errors.some((e) => e.includes('"theme"'))).toBe(true);
  });

  it("rejects invalid view and direction values", () => {
    const parsed = parseFileBlock("file: a.feature.yaml\nview: circles\ndirection: UP\n");
    expect(parsed.params).toBeUndefined();
    expect(parsed.errors).toHaveLength(2);
  });

  it("rejects non-map YAML and broken YAML", () => {
    expect(parseFileBlock("- just\n- a list\n").errors).toHaveLength(1);
    expect(parseFileBlock("file: [broken").errors).toHaveLength(1);
  });
});
