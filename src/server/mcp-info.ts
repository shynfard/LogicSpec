export interface McpTool {
  name: string;
  args: string;
  returns: string;
}

export interface McpInfo {
  command: string;
  tools: McpTool[];
}

const TOOLS: McpTool[] = [
  { name: "list_features", args: "—", returns: "Every feature: id, file, name, validity" },
  {
    name: "get_feature",
    args: "feature",
    returns: "The full inspect report (steps, edges, terminals, services, events, stats)",
  },
  {
    name: "get_step",
    args: "feature, step",
    returns: "One step: type, label, definition, outgoing transitions",
  },
  {
    name: "get_transitions",
    args: "feature, from?",
    returns: "Edge list, optionally filtered by source step",
  },
  {
    name: "get_service_dependencies",
    args: "feature?",
    returns: "Services and operations called (one feature, or the whole workspace)",
  },
  {
    name: "get_events",
    args: "feature?",
    returns: "Events published/waited on, enriched from the event catalog",
  },
  { name: "validate_feature", args: "feature", returns: "valid plus the full diagnostics list" },
];

/** Static info for the dashboard's MCP page — matches docs/integrations.md's tool table. */
export function mcpInfo(workspaceDir: string): McpInfo {
  return {
    command: `claude mcp add logicspec -- logicspec mcp ${workspaceDir}`,
    tools: TOOLS,
  };
}
