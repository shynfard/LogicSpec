import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { ERROR_CODES, errorResponse } from "./protocol.js";
import { createMcpHandler } from "./server.js";

const require = createRequire(import.meta.url);

/**
 * Runs the MCP server on stdio: newline-delimited JSON-RPC messages in on
 * stdin, responses out on stdout. Nothing but protocol messages may be
 * written to stdout — logging goes to stderr.
 */
export function runMcpServer(rootDir: string): void {
  const { version } = require("../../package.json") as { version: string };
  const handler = createMcpHandler({ rootDir, serverVersion: version });

  const write = (payload: unknown) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  // Serialize handling so responses always leave in request order.
  let queue: Promise<void> = Promise.resolve();

  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      write(errorResponse(null, ERROR_CODES.PARSE_ERROR, "Parse error: invalid JSON."));
      return;
    }
    try {
      const response = await handler(message);
      if (response !== undefined) write(response);
    } catch (error) {
      process.stderr.write(`logicspec mcp: ${(error as Error).message}\n`);
      write(errorResponse(null, ERROR_CODES.INTERNAL_ERROR, "Internal error."));
    }
  };

  const readline = createInterface({ input: process.stdin, terminal: false });
  readline.on("line", (line) => {
    queue = queue.then(() => handleLine(line));
  });
  process.stdin.on("error", (error) => {
    process.stderr.write(`logicspec mcp: stdin error: ${(error as Error).message}\n`);
  });
}
