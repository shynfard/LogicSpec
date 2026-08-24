import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { featureDependents, loadWorkspace } from "../workspace/loader.js";
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
import { defaultMermaidAssetPath } from "./assets.js";
import { findFeatureRecord, loadFeatureRecords } from "./data.js";
import { escapeHtml, layout } from "./html.js";
import { renderDashboardPage } from "./pages/dashboard.js";
import { renderFeatureDetailPage } from "./pages/feature-detail.js";
import { computeRelated } from "./related.js";

export interface DashboardServerOptions {
  /** Overrides the default `node_modules/mermaid` resolution (VS Code passes its own). */
  mermaidAssetPath?: string;
}

function sendHtml(res: http.ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function notFound(res: http.ServerResponse): void {
  sendHtml(res, layout({ title: "Not found", body: "<p>Not found.</p>" }), 404);
}

// Resolved two levels up then back down into dist/server/public, not as a
// sibling of *this* file: `src/server/` and `dist/server/` sit at the same
// depth below the package root, so this same relative path is correct both
// when running the compiled dist/server/create-server.js in production AND
// when Vitest runs src/server/create-server.ts directly in tests — a plain
// sibling `public/` path would only exist next to the compiled file.
const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(here, "../../dist/server/public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res: http.ServerResponse, filePath: string): void {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      serveIndexHtml(res);
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function serveIndexHtml(res: http.ServerResponse): void {
  fs.readFile(path.join(CLIENT_DIR, "index.html"), (error, data) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Dashboard client is not built — run `npm run build` first.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

/**
 * Creates (but does not start) the read-only dashboard HTTP server for the
 * workspace at `workspaceDir`. Every route reloads the workspace from disk
 * — no in-memory cache — the same "correctness over latency" stance as the
 * MCP server.
 */
export function createDashboardServer(
  workspaceDir: string,
  options: DashboardServerOptions = {},
): http.Server {
  const mermaidAssetPath = options.mermaidAssetPath ?? defaultMermaidAssetPath();
  const sseClients = new Set<http.ServerResponse>();
  const broadcastReload = (): void => {
    for (const client of sseClients) client.write("data: reload\n\n");
  };

  const initialWorkspace = loadWorkspace(workspaceDir);
  const watcher =
    initialWorkspace.configPath !== undefined
      ? watchWorkspace(
          watchTargetsFor(initialWorkspace, workspaceDir),
          () => broadcastReload(),
          () => {
            // A watcher error is non-fatal for a read-only dashboard: the
            // worst case is a stale page until the user refreshes by hand.
          },
        )
      : undefined;

  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (url.pathname === "/assets/mermaid.min.js") {
      fs.readFile(mermaidAssetPath, (error, data) => {
        if (error) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("mermaid asset not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(data);
      });
      return;
    }

    // The client SPA owns "/" and "/features/:id" now. Intercept them here,
    // ahead of the server-rendered page routes below — those routes stay
    // textually intact (Tasks 2-3 turn them into /api/* JSON endpoints) but
    // are unreachable for these two paths from this point on.
    if (url.pathname === "/" || url.pathname.startsWith("/features/")) {
      serveIndexHtml(res);
      return;
    }

    const workspace = loadWorkspace(workspaceDir);
    if (workspace.configPath === undefined) {
      sendHtml(
        res,
        layout({
          title: "No workspace",
          body: `<p>No logicspec.config.yaml found from ${escapeHtml(workspaceDir)} upward.</p>`,
        }),
        500,
      );
      return;
    }

    const records = loadFeatureRecords(workspace, workspaceDir);

    if (url.pathname === "/") {
      sendHtml(res, renderDashboardPage(records));
      return;
    }

    const detailMatch = /^\/features\/([^/]+)$/.exec(url.pathname);
    const rawId = detailMatch?.[1];
    if (rawId !== undefined) {
      const record = findFeatureRecord(records, decodeURIComponent(rawId));
      if (record === undefined) {
        notFound(res);
        return;
      }
      const related = computeRelated(record, records, featureDependents(workspace));
      sendHtml(res, renderFeatureDetailPage(record, related));
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      serveStatic(res, path.join(CLIENT_DIR, url.pathname));
      return;
    }

    serveIndexHtml(res);
  });

  server.on("close", () => {
    for (const client of sseClients) client.end();
    watcher?.close();
  });

  return server;
}
