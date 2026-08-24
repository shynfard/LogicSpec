import { describe, expect, it } from "vitest";
import { parseRoute } from "../../client/src/lib/router.js";

describe("parseRoute", () => {
  it("matches the feature list at /", () => {
    expect(parseRoute("/")).toEqual({ name: "list" });
  });

  it("matches a feature detail path, decoding the id", () => {
    expect(parseRoute("/features/my%20feature")).toEqual({ name: "detail", id: "my feature" });
  });

  it("matches /mcp", () => {
    expect(parseRoute("/mcp")).toEqual({ name: "mcp" });
  });

  it("falls back to not-found for anything else", () => {
    expect(parseRoute("/nope")).toEqual({ name: "not-found" });
  });
});
