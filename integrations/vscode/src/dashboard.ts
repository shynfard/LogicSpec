import { createDashboardServer } from "logicspec";
import * as vscode from "vscode";

const DEFAULT_PORT = 27000;
const HOST = "127.0.0.1";

interface RunningDashboard {
  server: ReturnType<typeof createDashboardServer>;
  url: string;
  dir: string;
}

let current: RunningDashboard | undefined;

function listenAndOpen(
  server: ReturnType<typeof createDashboardServer>,
  port: number,
  dir: string,
): void {
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && port !== 0) {
      listenAndOpen(server, 0, dir);
      return;
    }
    void vscode.window.showErrorMessage(`LogicSpec: dashboard server failed — ${error.message}`);
  });
  server.listen(port, HOST, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address !== null ? address.port : port;
    const url = `http://${HOST}:${boundPort}`;
    current = { server, url, dir };
    void vscode.env.openExternal(vscode.Uri.parse(url));
  });
}

/**
 * `LogicSpec: Start Dashboard` — one server per VS Code session, reused
 * across invocations for the same workspace directory. Passes the
 * extension's own build-time-copied `media/mermaid.min.js` instead of
 * letting the server resolve `node_modules/mermaid`: the packaged
 * extension ships without `node_modules` (.vscodeignore).
 */
export function startDashboard(context: vscode.ExtensionContext, startDir: string): void {
  if (current !== undefined) {
    if (current.dir === startDir) {
      void vscode.env.openExternal(vscode.Uri.parse(current.url));
      return;
    }
    current.server.close();
    current = undefined;
  }

  const mermaidAssetPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "mermaid.min.js",
  ).fsPath;
  const server = createDashboardServer(startDir, { mermaidAssetPath });
  listenAndOpen(server, DEFAULT_PORT, startDir);
}

export function disposeDashboard(): void {
  current?.server.close();
  current = undefined;
}
