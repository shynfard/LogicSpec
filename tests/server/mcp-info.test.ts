import { describe, expect, it } from "vitest";
import { mcpInfo } from "../../src/server/mcp-info.js";

describe("mcpInfo", () => {
  it("builds the registration command for the given workspace directory", () => {
    const info = mcpInfo("/home/me/my-workspace");
    expect(info.command).toBe("claude mcp add logicspec -- logicspec mcp /home/me/my-workspace");
  });

  it("leaves a Windows path unmangled and quotes only on whitespace", () => {
    // No spaces: backslashes pass through untouched, no quotes added.
    expect(mcpInfo("D:\\a\\LogicSpec\\examples\\booking").command).toBe(
      "claude mcp add logicspec -- logicspec mcp D:\\a\\LogicSpec\\examples\\booking",
    );
    // Spaces: plain double quotes, still no backslash doubling.
    expect(mcpInfo("C:\\My Specs\\shop").command).toBe(
      'claude mcp add logicspec -- logicspec mcp "C:\\My Specs\\shop"',
    );
    expect(mcpInfo("/home/me/my specs").command).toBe(
      'claude mcp add logicspec -- logicspec mcp "/home/me/my specs"',
    );
  });

  it("lists all ten MCP tools", () => {
    const info = mcpInfo("/tmp/x");
    expect(info.tools.map((t) => t.name)).toEqual([
      "list_features",
      "get_feature",
      "get_step",
      "get_transitions",
      "get_service_dependencies",
      "get_events",
      "validate_feature",
      "render_feature",
      "diff_feature",
      "get_data_flow",
    ]);
  });
});
