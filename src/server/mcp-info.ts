import { toolSummaries } from "../mcp/server.js";

export interface McpTool {
  name: string;
  args: string;
  returns: string;
}

export interface McpInfo {
  command: string;
  tools: McpTool[];
}

/** Quotes a path for display in a copy-pasteable shell command. */
function quoteArg(value: string): string {
  return /[\s"'\\$`]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Info for the dashboard's MCP page. The tool table is derived from the MCP
 * server's own definitions — never a hand-maintained copy.
 */
export function mcpInfo(workspaceDir: string): McpInfo {
  return {
    command: `claude mcp add logicspec -- logicspec mcp ${quoteArg(workspaceDir)}`,
    tools: toolSummaries().map((tool) => ({
      name: tool.name,
      args: tool.args,
      returns: tool.description,
    })),
  };
}
