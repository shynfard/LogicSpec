import { execFile } from "node:child_process";
import type { Server } from "node:http";
import path from "node:path";
import { createDashboardServer } from "../server/create-server.js";
import { color, type Io, printDiagnostics, processIo } from "./report.js";
import { EXIT_OK, EXIT_USAGE, requireWorkspace } from "./shared.js";

export interface ServeCommandOptions {
  port?: number;
  host?: string;
  open?: boolean;
  cwd?: string;
  io?: Io;
  /** Test seam: called once the server is actually listening. */
  onListening?: (server: Server) => void;
}

const DEFAULT_PORT = 27000;
const DEFAULT_HOST = "127.0.0.1";

/** Opens `url` in the platform's default browser without invoking a shell. */
function openInBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  execFile(command, args, () => {
    // Best-effort: a missing opener just means the user opens the URL themselves.
  });
}

/** `logicspec serve [dir]` — a local read-only dashboard over the workspace at `dir`. */
export function runServe(dirArg: string | undefined, options: ServeCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const startDir = path.resolve(cwd, dirArg ?? ".");

  const resolved = requireWorkspace(startDir);
  if ("error" in resolved) {
    printDiagnostics([resolved.error], io);
    return EXIT_USAGE;
  }

  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const server = createDashboardServer(startDir);

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;
    const url = `http://${host}:${boundPort}`;
    io.out(`${color.green("✓")} LogicSpec dashboard running at ${color.bold(url)}`);
    if (options.open === true) openInBrowser(url);
    options.onListening?.(server);
  });

  return EXIT_OK;
}
