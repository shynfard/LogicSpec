import { execFile } from "node:child_process";
import type { Server } from "node:http";
import net from "node:net";
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
  /** Test seam: skip installing SIGINT/SIGTERM handlers on the process. */
  handleSignals?: boolean;
}

export const DEFAULT_PORT = 27000;
export const DEFAULT_HOST = "127.0.0.1";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** `http://host:port` with IPv6 hosts bracketed and wildcards made navigable. */
function dashboardUrl(host: string, port: number): string {
  const navigable = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const authority = net.isIPv6(navigable) ? `[${navigable}]` : navigable;
  return `http://${authority}:${port}`;
}

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

  if (!LOOPBACK.has(host)) {
    io.err(
      `${color.yellow("⚠")} Binding ${host}: the dashboard serves this workspace's raw YAML ` +
        "source, unauthenticated, to anything that can reach that address.",
    );
  }

  const server = createDashboardServer(startDir, { allowedHosts: [host] });

  server.on("error", (error: NodeJS.ErrnoException) => {
    const reason =
      error.code === "EADDRINUSE"
        ? `Port ${port} on ${host} is already in use. Pass --port to pick another.`
        : error.code === "EADDRNOTAVAIL" || error.code === "ENOTFOUND"
          ? `Cannot bind host ${host}: ${error.code}.`
          : error.message;
    io.err(`${color.red("✗")} Cannot start dashboard: ${reason}`);
    process.exitCode = EXIT_USAGE;
    server.close();
  });

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;
    const url = dashboardUrl(host, boundPort);
    io.out(`${color.green("✓")} LogicSpec dashboard running at ${color.bold(url)}`);
    if (options.open === true) openInBrowser(url);
    options.onListening?.(server);
  });

  if (options.handleSignals !== false) {
    const shutdown = (): void => {
      io.out("\nStopping dashboard.");
      server.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  return EXIT_OK;
}
