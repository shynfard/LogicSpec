import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countBySeverity } from "../diagnostics/diagnostic.js";
import { inspectFeature } from "../inspect.js";
import { renderMermaid } from "../renderers/markdown.js";
import type { RenderView } from "../schema/config.js";
import { featureDependents, loadWorkspace } from "../workspace/loader.js";
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
import { buildNodeClickMap } from "./click-map.js";
import type { FeatureRecord } from "./data.js";
import { findFeatureRecord, loadFeatureRecords } from "./data.js";
import { mcpInfo } from "./mcp-info.js";
import { computeRelated } from "./related.js";

export interface DashboardServerOptions {
  /**
   * Absolute path to the built client's public directory (the one
   * containing `index.html` and `assets/`). Optional — when omitted,
   * `defaultClientDir()` computes it. Callers that bundle this module with
   * esbuild's CJS output (the VS Code extension) must always supply this:
   * see `defaultClientDir()` for why relative-path introspection cannot
   * recover the right directory once bundled.
   */
  publicDir?: string;
}

/**
 * Computes the default client public directory when the caller doesn't
 * supply `options.publicDir`. Lazy by design — called only from inside
 * `createDashboardServer()`, never at module load — so a caller that always
 * provides `publicDir` (the VS Code extension) never even attempts this
 * context-sensitive resolution.
 *
 * Resolved two levels up then back down into dist/server/public, not as a
 * sibling of *this* file: `src/server/` and `dist/server/` sit at the same
 * depth below the package root, so this relative path is correct both when
 * running the compiled dist/server/create-server.js in production AND when
 * Vitest runs src/server/create-server.ts directly in tests — a plain
 * sibling `public/` path would only exist next to the compiled file.
 *
 * esbuild's CJS bundle (used by the VS Code extension) leaves
 * `import.meta.url` empty — its own build warns this explicitly — but does
 * provide a real, per-module `__dirname`, so the `typeof __dirname` check
 * below avoids the crash there. But `__dirname` alone is NOT a full fix for
 * the bundled extension: esbuild produces exactly ONE bundled module for
 * the whole extension (`integrations/vscode/dist/extension.cjs`), so every
 * line of code in that bundle shares the SAME `__dirname`
 * (`integrations/vscode/dist/`) regardless of which original source file it
 * came from — there is no relative-path formula from there that reaches
 * the real `dist/server/public` (which isn't even copied into the
 * extension's own packaged output by default). That's why `publicDir`
 * exists: the VS Code extension always supplies it explicitly instead of
 * relying on this function. This function stays correct for the contexts
 * where per-file `__dirname`/`import.meta.url` is meaningful — the CLI and
 * Vitest — and its `__dirname` fallback remains as a safety net for any
 * other hypothetical CJS-bundled caller that doesn't supply an override.
 */
function defaultClientDir(): string {
  const here =
    typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../dist/server/public");
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function serveStatic(res: http.ServerResponse, filePath: string, clientDir: string): void {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      serveIndexHtml(res, clientDir);
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function serveIndexHtml(res: http.ServerResponse, clientDir: string): void {
  fs.readFile(path.join(clientDir, "index.html"), (error, data) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Dashboard client is not built — run `npm run build` first.");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

function serializeFeatureSummary(record: FeatureRecord) {
  const counts = countBySeverity(record.result.diagnostics);
  return {
    id: record.id,
    name: record.name,
    path: record.target.display,
    valid: record.result.valid,
    errorCount: counts.error,
    warningCount: counts.warning,
    steps: record.result.stats?.steps ?? 0,
  };
}

function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

const DIAGRAM_VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];

function serializeFeatureDetail(
  record: import("./data.js").FeatureRecord,
  related: import("./related.js").RelatedFeatures,
) {
  const { normalized, graph } = record.result;
  const diagnostics = record.result.diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    line: d.location?.line,
    column: d.location?.column,
  }));

  const base = {
    id: record.id,
    name: record.name,
    path: record.target.display,
    source: record.source,
    valid: record.result.valid,
    diagnostics,
    related,
  };

  if (!record.result.valid || normalized === undefined || graph === undefined) {
    return base;
  }

  const mermaid: Record<string, string> = {};
  for (const view of DIAGRAM_VIEWS) {
    try {
      mermaid[view] = renderMermaid(normalized, graph, { view });
    } catch {
      mermaid[view] = "";
    }
  }

  return {
    ...base,
    diagram: {
      steps: normalized.steps.map((s) => {
        const def = s.def as { requires?: string[]; produces?: string[] };
        return {
          id: s.id,
          type: s.type,
          label: s.label,
          actor: s.actor,
          requires: def.requires ?? [],
          produces: def.produces ?? [],
        };
      }),
      edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label })),
      actors: normalized.actors.map((a) => ({ id: a.id, label: a.label })),
      mermaid,
      clickMap: buildNodeClickMap(normalized, graph),
    },
    inspect: inspectFeature(normalized, graph),
  };
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
  const CLIENT_DIR = options.publicDir ?? defaultClientDir();
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

    // Built client assets must be served from disk regardless of whether
    // workspaceDir has a logicspec.config.yaml — VS Code's startDashboard() calls
    // createDashboardServer() with no upfront workspace check, so a
    // no-config folder must still be able to load the SPA shell's JS/CSS
    // instead of getting the "no workspace" 500 below.
    if (url.pathname.startsWith("/assets/")) {
      serveStatic(res, path.join(CLIENT_DIR, url.pathname), CLIENT_DIR);
      return;
    }

    // The client SPA owns "/" and "/features/:id" now — the server-rendered
    // page routes that used to live at these exact paths were replaced by
    // /api/features and /api/features/:id in Tasks 2-3. This intercept still
    // earns its keep, though: it must run *before* the "no workspace" gate
    // below. Without it, opening the dashboard on a folder with no
    // logicspec.config.yaml would 500 at "/" and "/features/*" instead of
    // loading the SPA shell — breaking the same VS Code "Start Dashboard
    // from an arbitrary folder" flow that /assets/* is special-cased for
    // above (see spa-fallback.test.ts).
    if (url.pathname === "/" || url.pathname.startsWith("/features/")) {
      serveIndexHtml(res, CLIENT_DIR);
      return;
    }

    const workspace = loadWorkspace(workspaceDir);
    if (workspace.configPath === undefined) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(
          res,
          { error: `No logicspec.config.yaml found from ${workspaceDir} upward.` },
          500,
        );
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`No logicspec.config.yaml found from ${workspaceDir} upward.`);
      }
      return;
    }

    const records = loadFeatureRecords(workspace, workspaceDir);

    if (url.pathname === "/api/features") {
      sendJson(
        res,
        [...records].sort((a, b) => a.id.localeCompare(b.id)).map(serializeFeatureSummary),
      );
      return;
    }

    if (url.pathname === "/api/mcp") {
      sendJson(res, mcpInfo(workspaceDir));
      return;
    }

    const detailMatch = /^\/api\/features\/([^/]+)$/.exec(url.pathname);
    const rawId = detailMatch?.[1];
    if (rawId !== undefined) {
      const record = findFeatureRecord(records, decodeURIComponent(rawId));
      if (record === undefined) {
        sendJson(res, { error: "not found" }, 404);
        return;
      }
      const related = computeRelated(record, records, featureDependents(workspace));
      sendJson(res, serializeFeatureDetail(record, related));
      return;
    }

    serveIndexHtml(res, CLIENT_DIR);
  });

  server.on("close", () => {
    for (const client of sseClients) client.end();
    watcher?.close();
  });

  return server;
}
