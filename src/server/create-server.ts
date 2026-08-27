import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countBySeverity } from "../diagnostics/diagnostic.js";
import { inspectFeature } from "../inspect.js";
import { renderMermaid } from "../renderers/markdown.js";
import type { RenderView } from "../schema/config.js";
import { detailRefs } from "../schema/feature.js";
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
  /**
   * Extra hostnames accepted in the `Host` request header, on top of the
   * loopback names that are always allowed. Requests carrying any other
   * `Host` are rejected with 403 — the defense against DNS rebinding, where
   * a hostile page resolves its own domain to 127.0.0.1 and reads the
   * workspace source through the victim's browser. Passing the wildcard
   * binds `"0.0.0.0"` or `"::"` disables the check entirely: the caller has
   * explicitly chosen network-wide exposure.
   */
  allowedHosts?: readonly string[];
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

function hostHeaderAllowed(header: string | undefined, extra: ReadonlySet<string>): boolean {
  if (header === undefined) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${header}`).hostname;
  } catch {
    return false;
  }
  // WHATWG URL keeps IPv6 hostnames bracketed ("[::1]"); compare bare.
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return LOOPBACK_HOSTS.has(bare) || extra.has(bare);
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
  // The caller derives filePath from a URL pathname (see the /assets/* route
  // below); WHATWG URL parsing already normalizes `..` dot-segments, so this
  // never actually escapes clientDir today. The realpath containment below
  // makes that guarantee explicit — and, unlike a prefix check on the
  // unresolved path, it also refuses symlinks inside clientDir that point
  // outside it.
  let realClientDir: string;
  let realFilePath: string;
  try {
    realClientDir = fs.realpathSync(path.resolve(clientDir));
    realFilePath = fs.realpathSync(path.resolve(filePath));
  } catch {
    // Missing asset: a 404, never the SPA shell — a broken script tag must
    // not come back as 200 text/html.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  const rel = path.relative(realClientDir, realFilePath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  fs.readFile(realFilePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const contentType = CONTENT_TYPES[path.extname(realFilePath)] ?? "application/octet-stream";
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
    description: record.result.normalized?.description,
    path: record.target.display,
    valid: record.result.valid,
    errorCount: counts.error,
    warningCount: counts.warning,
    steps: record.result.stats?.steps ?? 0,
  };
}

function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  // no-store: API responses expose workspace source; they must never land in
  // a shared or disk cache, and the dashboard always wants fresh data anyway.
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
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
    description: normalized?.description,
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
        const def = s.def as {
          requires?: string[];
          produces?: string[];
          details?: Array<string | Record<string, string>>;
        };
        return {
          id: s.id,
          type: s.type,
          label: s.label,
          actor: s.actor,
          description: s.description,
          notes: s.notes,
          tags: s.tags,
          requires: def.requires ?? [],
          produces: def.produces ?? [],
          details: detailRefs(def),
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
 * workspace at `workspaceDir`. Workspace state is cached in memory and
 * invalidated by the same file watcher that drives live reload, so a page
 * load costs one workspace read after every change instead of one per
 * request. Without a watcher (no config file at startup, or a watcher
 * error), every route falls back to reloading from disk — correctness over
 * latency, the MCP server's stance.
 */
export function createDashboardServer(
  workspaceDir: string,
  options: DashboardServerOptions = {},
): http.Server {
  const CLIENT_DIR = options.publicDir ?? defaultClientDir();
  const extraHosts = new Set(options.allowedHosts ?? []);
  // Binding a wildcard address is an explicit "expose to the network" choice;
  // remote clients then address the machine by whatever name reaches it, so a
  // Host allowlist cannot work and is disabled (the CLI warns loudly instead).
  const skipHostCheck = extraHosts.has("0.0.0.0") || extraHosts.has("::");
  const sseClients = new Set<http.ServerResponse>();
  let reloadTimer: NodeJS.Timeout | undefined;
  const broadcastReload = (): void => {
    // Coalesce bursts (branch switches touch many files at once) into a
    // single reload event; the SPA refetches everything on each one.
    if (reloadTimer !== undefined) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      for (const client of sseClients) {
        try {
          client.write("data: reload\n\n");
        } catch {
          sseClients.delete(client);
        }
      }
    }, 100);
    reloadTimer.unref?.();
  };

  interface WorkspaceState {
    workspace: ReturnType<typeof loadWorkspace>;
    records: FeatureRecord[];
    /** Detail payloads memoized per feature id — rendering all four Mermaid
     * views is the expensive part of a detail request. */
    details: Map<string, unknown>;
  }
  let cachedState: WorkspaceState | undefined;
  let watcherHealthy = false;
  const invalidate = (): void => {
    cachedState = undefined;
  };

  const initialWorkspace = loadWorkspace(workspaceDir);
  const watcher =
    initialWorkspace.configPath !== undefined
      ? watchWorkspace(
          watchTargetsFor(initialWorkspace, workspaceDir),
          () => {
            invalidate();
            broadcastReload();
          },
          () => {
            // A watcher error is non-fatal for a read-only dashboard, but the
            // cache can no longer trust its invalidation signal — disable it
            // and fall back to per-request reloads.
            watcherHealthy = false;
            invalidate();
          },
        )
      : undefined;
  watcherHealthy = watcher !== undefined;

  const loadState = (): WorkspaceState => {
    if (watcherHealthy && cachedState !== undefined) return cachedState;
    const workspace = loadWorkspace(workspaceDir);
    const records =
      workspace.configPath !== undefined ? loadFeatureRecords(workspace, workspaceDir) : [];
    const state: WorkspaceState = { workspace, records, details: new Map() };
    if (watcherHealthy && workspace.configPath !== undefined) cachedState = state;
    return state;
  };

  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
      return;
    }

    if (!skipHostCheck && !hostHeaderAllowed(req.headers.host, extraHosts)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: unrecognized Host header.");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end();
        return;
      }
      sendJson(res, { status: "ok" });
      return;
    }

    // HEAD support for the page routes so health checkers and `curl -I`
    // work; headers only, mirroring what a GET of the SPA shell would send.
    if (req.method === "HEAD") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end();
      return;
    }

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

    const state = loadState();
    const { workspace, records } = state;
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
      let featureId: string;
      try {
        featureId = decodeURIComponent(rawId);
      } catch {
        // Malformed percent-encoding ("/api/features/%") is a client error,
        // not a reason to throw out of the handler.
        sendJson(res, { error: "not found" }, 404);
        return;
      }
      const record = findFeatureRecord(records, featureId);
      if (record === undefined) {
        sendJson(res, { error: "not found" }, 404);
        return;
      }
      let detail = state.details.get(record.id);
      if (detail === undefined) {
        const related = computeRelated(record, records, featureDependents(workspace));
        detail = serializeFeatureDetail(record, related);
        state.details.set(record.id, detail);
      }
      sendJson(res, detail);
      return;
    }

    serveIndexHtml(res, CLIENT_DIR);
  };

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch {
      // A handler bug must cost one 500 response, never the process. The
      // body stays generic: internal messages can carry workspace paths.
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: "Internal server error." }));
    }
  });

  server.on("close", () => {
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
    for (const client of sseClients) client.end();
    watcher?.close();
  });

  return server;
}
