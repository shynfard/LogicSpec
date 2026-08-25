import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/useApi";

interface McpTool {
  name: string;
  args: string;
  returns: string;
}

interface McpInfoData {
  command: string;
  tools: McpTool[];
}

export function McpInfo() {
  const { data, error } = useApi<McpInfoData>("/api/mcp");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  if (error !== null) return <p className="p-6 text-destructive">{error}</p>;
  if (data === null) return <p className="p-6 text-muted-foreground">Loading…</p>;

  const canCopy = typeof navigator.clipboard !== "undefined";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">MCP Server</h1>
      <p className="text-sm text-muted-foreground">
        Register this workspace with an MCP client (e.g. Claude Code):
      </p>
      <div className="flex items-center gap-2">
        <pre className="flex-1 overflow-auto rounded bg-muted p-3 text-xs">{data.command}</pre>
        {canCopy ? (
          <Button
            size="sm"
            onClick={() => {
              navigator.clipboard
                .writeText(data.command)
                .then(() => {
                  setCopied(true);
                  setCopyError(false);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {
                  setCopyError(true);
                  setTimeout(() => setCopyError(false), 1500);
                });
            }}
          >
            {copyError ? "Copy failed" : copied ? "Copied" : "Copy"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Copy unavailable (not a secure context)
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">Tool</th>
            <th className="p-2">Arguments</th>
            <th className="p-2">Returns</th>
          </tr>
        </thead>
        <tbody>
          {data.tools.map((tool) => (
            <tr key={tool.name} className="border-b align-top">
              <td className="p-2 font-mono">{tool.name}</td>
              <td className="p-2 font-mono text-xs">{tool.args}</td>
              <td className="p-2">{tool.returns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
