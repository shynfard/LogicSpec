import { describe, expect, it } from "vitest";
import { mcpInfo } from "../../src/server/mcp-info.js";

describe("mcpInfo", () => {
  it("builds the registration command for the given workspace directory", () => {
    const info = mcpInfo("/home/me/my-workspace");
    expect(info.command).toBe("claude mcp add logicspec -- logicspec mcp /home/me/my-workspace");
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
