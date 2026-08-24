import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultMermaidAssetPath } from "../../src/server/assets.js";

describe("defaultMermaidAssetPath", () => {
  it("resolves to an existing file named mermaid.min.js", () => {
    const assetPath = defaultMermaidAssetPath();
    expect(assetPath.endsWith("mermaid.min.js")).toBe(true);
    expect(fs.existsSync(assetPath)).toBe(true);
  });
});
