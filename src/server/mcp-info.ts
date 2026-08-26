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

/**
 * Quotes a path for display in a copy-pasteable shell command. Backslashes
 * pass through untouched — a Windows path must not come out JSON-escaped.
 */
function quoteArg(value: string): string {
  if (!/[\s"']/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
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
