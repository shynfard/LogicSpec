# Dashboard SPA Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the server-rendered HTML dashboard with a React SPA (Vite + shadcn/ui), a small JSON API, a ported interactive diagram canvas, and an MCP-info page — while `logicspec serve` and VS Code's "Start Dashboard" keep the same URLs and behavior from the outside.

**Architecture:** `createDashboardServer` shrinks to a JSON API (`/api/features`, `/api/features/:id`, `/api/mcp`, `/events`) plus a static-file/SPA-fallback server for a new `client/` React app (Vite-built, output written straight into `dist/server/public/`). The client has zero dependency on `logicspec` — it only ever calls its own API. All LogicSpec-domain computation stays exactly where it already is (`src/server/data.ts`, `related.ts`, `click-map.ts`).

**Tech Stack:** Vite 6, React 19, TypeScript, `@xyflow/react` + `@dagrejs/dagre` (interactive canvas — same library already used by `integrations/editor/`), Tailwind CSS v4, shadcn/ui (copied component source), `mermaid` (bundled by Vite, no longer resolved from `node_modules` at request time).

**Spec:** `docs/superpowers/specs/2026-08-25-dashboard-spa-rewrite-design.md`

## Global Constraints

- `client/` is a **sibling directory to `src/`, not a separate npm package** — no `client/package.json`. Vite/TypeScript/lint all run against it using the root package's `node_modules` and devDependencies.
- The client **never imports `logicspec` or `logicspec/core`** — it only calls its own JSON API (`fetch`). All validation/normalization/rendering stays server-side.
- React, `@xyflow/react`, `@dagrejs/dagre`, `mermaid`, Vite, Tailwind, and shadcn's Radix/`cva`/`clsx` dependencies go in root `package.json` **`devDependencies`**, never `dependencies` — they're bundled into static output at build time, never resolved from `node_modules` at request time. A plain `npm install logicspec` ends up with exactly `chokidar`, `commander`, `yaml`, `zod` as real runtime dependencies (`mermaid` moves back out of `dependencies`, where the previous dashboard design had put it).
- `createDashboardServer` keeps re-reading the workspace from disk on every API request — no in-memory cache — the same "correctness over latency" stance as the MCP server and the server-rendered dashboard before it.
- Any GET request that isn't `/api/*` or `/events` serves the built `client/`'s `index.html` (SPA fallback) instead of 404ing, so client-side routing owns the URL.
- Automated client tests are **pure logic only** (no component-rendering tests) — matches this codebase's existing convention for `integrations/vscode`'s webview canvas, which has zero automated tests and is verified manually. Component/interaction behavior (drag/zoom/hover, tabs, live reload) is verified by hand against the real built app.
- Git commits in this plan **never include AI-attribution trailers** (no `Co-Authored-By`/`Claude-Session` lines) — a standing preference for this project.
- Biome formatting (double quotes, 2-space indent, 100-char width) applies to `client/` too — run `npm run lint:fix` after any step that adds new files.

---

### Task 1: Bootstrap the `client/` Vite toolchain

**Files:**
- Create: `client/vite.config.ts`, `client/tsconfig.json`, `client/index.html`, `client/src/main.tsx`
- Modify: `package.json` (new devDependencies, `build`/`typecheck`/`lint` scripts), `src/server/create-server.ts` (SPA fallback)
- Test: `tests/server/spa-fallback.test.ts`

**Interfaces:**
- Produces: a Vite build that writes `index.html` + hashed JS/CSS into `dist/server/public/`. `createDashboardServer` serves that directory statically and falls back to `index.html` for any unmatched GET route.

This task proves the whole toolchain end-to-end with a placeholder page before any real feature code — the riskiest unknown (does Vite integrate cleanly into this repo's build/lint/typecheck pipeline) gets resolved first.

- [ ] **Step 1: Add the new devDependencies**

In `package.json`, add to `"devDependencies"` (alphabetical, matching the existing list style):

```json
"devDependencies": {
  "@biomejs/biome": "^2.0.0",
  "@types/node": "^22.0.0",
  "@types/react": "^19.2.18",
  "@types/react-dom": "^19.2.4",
  "@vitejs/plugin-react": "^4.3.0",
  "react": "^19.2.8",
  "react-dom": "^19.2.8",
  "typescript": "^5.7.0",
  "vite": "^6.0.0",
  "vitest": "^3.0.0"
}
```

Run: `npm install`
Expected: `node_modules/vite`, `node_modules/react`, etc. appear; `package-lock.json` updates.

- [ ] **Step 2: Write `client/vite.config.ts`**

```ts
// client/vite.config.ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist/server/public", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:27000",
      "/events": "http://127.0.0.1:27000",
    },
  },
});
```

- [ ] **Step 3: Write `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 4: Write a placeholder entry (`client/index.html`, `client/src/main.tsx`)**

```html
<!-- client/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LogicSpec Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <p>LogicSpec Dashboard — under construction.</p>
  </StrictMode>,
);
```

- [ ] **Step 5: Wire root `package.json` scripts**

```json
"scripts": {
  "build": "tsc -p tsconfig.build.json && vite build --config client/vite.config.ts",
  "prepublishOnly": "npm run typecheck && npm run lint && npm test",
  "typecheck": "tsc --noEmit && tsc --noEmit -p client/tsconfig.json",
  "lint": "biome check src tests scripts client",
  "lint:fix": "biome check --write src tests scripts client",
  "format": "biome format --write src tests scripts client",
  "test": "vitest run",
  "test:watch": "vitest",
  "schemas": "npm run build && node scripts/generate-schemas.mjs",
  "prepack": "npm run build"
}
```

- [ ] **Step 6: Run the build to verify the toolchain works**

Run: `npm run build`
Expected: `dist/server/public/index.html` and a hashed `assets/*.js`/`assets/*.css` exist.

- [ ] **Step 7: Write the failing SPA-fallback test**

```ts
// tests/server/spa-fallback.test.ts
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let base: string;

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SPA fallback", () => {
  it("serves the built index.html for the root path", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="root">');
  });

  it("serves index.html for a client-side route too", async () => {
    const res = await fetch(`${base}/features/booking`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it("serves the built JS bundle", async () => {
    const indexRes = await fetch(`${base}/`);
    const html = await indexRes.text();
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(html);
    expect(scriptMatch).not.toBeNull();
    const scriptPath = scriptMatch?.[1] as string;
    const res = await fetch(`${base}${scriptPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/server/spa-fallback.test.ts`
Expected: FAIL — `create-server.ts` doesn't serve static files yet, still on the old HTML-rendering routes.

- [ ] **Step 9: Add the static-file + SPA-fallback handling to `create-server.ts`**

In `src/server/create-server.ts`, add the imports:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
```

(`fileURLToPath(import.meta.url)`, not `import.meta.dirname` — the latter needs Node 20.11+, and this package's stated floor is Node ≥20.0.0.)

Add near the top of the file (module scope, alongside `sendHtml`/`notFound`):

```ts
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
```

Whether this module is the compiled `dist/server/create-server.js` (production) or the source `src/server/create-server.ts` (Vitest), `CLIENT_DIR` resolves to the same absolute path: `<package root>/dist/server/public` — exactly where Task 1's Vite build writes its output.

- [ ] **Step 10: Route static assets and the SPA fallback**

Still in `create-server.ts`, inside the request handler, replace the block that currently handles `/assets/mermaid.min.js` and the eventual `notFound(res)` fallback. Find:

```ts
    if (url.pathname === "/assets/mermaid.min.js") {
```

Leave that block as-is for now (Task 12 removes it once the client bundles mermaid itself). Find the final `notFound(res);` at the end of the handler and replace it with:

```ts
    if (url.pathname.startsWith("/assets/")) {
      serveStatic(res, path.join(CLIENT_DIR, url.pathname));
      return;
    }

    serveIndexHtml(res);
```

This makes every unmatched GET path (including `/` and any client route like `/features/:id`) fall through to the SPA shell instead of a 404, while `/assets/*` serves the real built files.

- [ ] **Step 11: Run test to verify it passes**

Run: `npx vitest run tests/server/spa-fallback.test.ts`
Expected: PASS

- [ ] **Step 12: Typecheck and lint everything**

Run: `npm run typecheck && npm run lint:fix`
Expected: PASS (lint:fix may reformat the new `client/` files — that's expected).

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json client/vite.config.ts client/tsconfig.json client/index.html client/src/main.tsx src/server/create-server.ts tests/server/spa-fallback.test.ts
git commit -m "feat: bootstrap the client/ Vite toolchain and SPA fallback route"
```

---

### Task 2: `GET /api/features` — replace the dashboard listing page

**Files:**
- Modify: `src/server/create-server.ts`
- Delete: `src/server/pages/dashboard.ts`, `tests/server/pages/dashboard.test.ts`
- Test: `tests/server/api-features.test.ts`

**Interfaces:**
- Consumes: `FeatureRecord` from `./data.js` (unchanged).
- Produces: `GET /api/features` → `Array<{ id: string; name: string; path: string; valid: boolean; errorCount: number; warningCount: number; steps: number }>` (JSON).

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/api-features.test.ts
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let base: string;

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/features", () => {
  it("lists every feature with validity and step count", async () => {
    const res = await fetch(`${base}/api/features`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Array<{
      id: string;
      name: string;
      valid: boolean;
      steps: number;
    }>;
    const ids = body.map((f) => f.id).sort();
    expect(ids).toEqual(["booking", "notify-booking"]);
    const booking = body.find((f) => f.id === "booking");
    expect(booking?.name).toBe("Booking");
    expect(booking?.valid).toBe(true);
    expect(booking?.steps).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api-features.test.ts`
Expected: FAIL — `/api/features` doesn't exist yet.

- [ ] **Step 3: Add the endpoint**

In `src/server/create-server.ts`, remove the import of `renderDashboardPage`:

```ts
import { renderDashboardPage } from "./pages/dashboard.js";
```

Add instead:

```ts
import { countBySeverity } from "../diagnostics/diagnostic.js";
import type { FeatureRecord } from "./data.js";
```

Add a small serializer function above `createDashboardServer`:

```ts
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
```

Find the block:

```ts
    if (url.pathname === "/") {
      sendHtml(res, renderDashboardPage(records));
      return;
    }
```

Replace it with:

```ts
    if (url.pathname === "/api/features") {
      sendJson(
        res,
        [...records].sort((a, b) => a.id.localeCompare(b.id)).map(serializeFeatureSummary),
      );
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api-features.test.ts`
Expected: PASS

- [ ] **Step 5: Delete the retired page renderer and its test**

```bash
rm src/server/pages/dashboard.ts tests/server/pages/dashboard.test.ts
```

- [ ] **Step 6: Typecheck, lint, and run the full server test suite**

Run: `npm run typecheck && npm run lint:fix && npx vitest run tests/server`
Expected: PASS — no leftover references to `renderDashboardPage`.

- [ ] **Step 7: Commit**

```bash
git add -A src/server tests/server
git commit -m "feat: add GET /api/features, retire the server-rendered dashboard page"
```

---

### Task 3: `GET /api/features/:id` — replace the feature detail page

**Files:**
- Modify: `src/server/create-server.ts`
- Delete: `src/server/pages/feature-detail.ts`, `tests/server/pages/feature-detail.test.ts`, `src/server/html.ts`, `tests/server/html.test.ts`
- Test: `tests/server/api-feature-detail.test.ts`

**Interfaces:**
- Consumes: `FeatureRecord`, `computeRelated`, `buildNodeClickMap`, `inspectFeature`, `renderMermaid` (all unchanged, already built).
- Produces: `GET /api/features/:id` → JSON:
  ```ts
  {
    id: string; name: string; path: string; source: string;
    valid: boolean;
    diagnostics: Array<{ code: string; severity: string; message: string; line?: number; column?: number }>;
    diagram?: {
      steps: Array<{ id: string; type: string; label: string; actor?: string; requires?: string[]; produces?: string[] }>;
      edges: Array<{ from: string; to: string; kind: string; label?: string }>;
      actors: Array<{ id: string; label: string }>;
      mermaid: { flow: string; swimlane: string; sequence: string; "event-model": string };
      clickMap: Record<string, { stepId: string; flow?: string }>;
    };
    inspect?: unknown;
    related: { subflows: RelatedFeatureRef[]; dependents: RelatedFeatureRef[]; events: RelatedEvent[] };
  }
  ```
  `diagram`/`inspect` are omitted when the feature is invalid (`normalized`/`graph` unavailable) — matches the existing "Spec is invalid" fallback behavior.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/api-feature-detail.test.ts
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let base: string;

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/features/:id", () => {
  it("returns the full detail payload for a valid feature", async () => {
    const res = await fetch(`${base}/api/features/booking`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      source: string;
      diagram?: { steps: unknown[]; mermaid: Record<string, string>; clickMap: Record<string, unknown> };
      inspect?: { feature: string };
      related: { events: Array<{ event: string; feature: { id: string } }> };
    };
    expect(body.id).toBe("booking");
    expect(body.source).toContain("feature:");
    expect(body.diagram?.steps.length).toBeGreaterThan(0);
    expect(body.diagram?.mermaid.flow).toContain("flowchart");
    expect(body.inspect?.feature).toBe("booking");
    expect(body.related.events).toContainEqual(
      expect.objectContaining({ event: "BookingCreated", feature: { id: "notify-booking", name: "Booking Notification", known: true } }),
    );
  });

  it("404s for an unknown feature id", async () => {
    const res = await fetch(`${base}/api/features/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api-feature-detail.test.ts`
Expected: FAIL — `/api/features/:id` doesn't exist yet.

- [ ] **Step 3: Add the endpoint**

In `src/server/create-server.ts`, remove:

```ts
import { renderFeatureDetailPage } from "./pages/feature-detail.js";
```

Add:

```ts
import { buildNodeClickMap } from "./click-map.js";
import { inspectFeature } from "../inspect.js";
import { renderMermaid } from "../renderers/markdown.js";
import type { RenderView } from "../schema/config.js";
```

Add a serializer above `createDashboardServer` (near `serializeFeatureSummary`):

```ts
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
```

Find the block:

```ts
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
```

Replace it with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api-feature-detail.test.ts`
Expected: PASS

- [ ] **Step 5: Replace the "no workspace" HTML error page with JSON**

`html.ts` (and the two page renderers already deleted) are the only remaining users of `layout`/`escapeHtml` in `create-server.ts` — this step removes that last usage so the files can be safely deleted in Step 6.

In `src/server/create-server.ts`, find:

```ts
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
```

Replace it with:

```ts
    const workspace = loadWorkspace(workspaceDir);
    if (workspace.configPath === undefined) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(res, { error: `No logicspec.config.yaml found from ${workspaceDir} upward.` }, 500);
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`No logicspec.config.yaml found from ${workspaceDir} upward.`);
      }
      return;
    }
```

Remove the now-unused `sendHtml`/`notFound` functions and their `escapeHtml`/`layout` import from the top of the file.

- [ ] **Step 6: Delete the retired page renderer, its test, `html.ts`, and its test**

```bash
rm src/server/pages/feature-detail.ts tests/server/pages/feature-detail.test.ts src/server/html.ts tests/server/html.test.ts
rmdir src/server/pages tests/server/pages 2>/dev/null || true
```

- [ ] **Step 7: Typecheck, lint, and run the full server test suite**

Run: `npm run typecheck && npm run lint:fix && npx vitest run tests/server`
Expected: PASS — no leftover references to `renderFeatureDetailPage`, `layout`, `escapeHtml`, `sendHtml`, or `notFound`.

- [ ] **Step 8: Commit**

```bash
git add -A src/server tests/server
git commit -m "feat: add GET /api/features/:id, retire server-rendered HTML templating"
```

---

### Task 4: `GET /api/mcp` — MCP server info

**Files:**
- Modify: `src/server/create-server.ts`
- Create: `src/server/mcp-info.ts`
- Test: `tests/server/mcp-info.test.ts`, `tests/server/api-mcp.test.ts`

**Interfaces:**
- Produces: `mcpInfo(workspaceDir: string): McpInfo` where `McpInfo = { command: string; tools: Array<{ name: string; args: string; returns: string }> }`. `GET /api/mcp` serializes this.

- [ ] **Step 1: Write the failing test for the pure data function**

```ts
// tests/server/mcp-info.test.ts
import { describe, expect, it } from "vitest";
import { mcpInfo } from "../../src/server/mcp-info.js";

describe("mcpInfo", () => {
  it("builds the registration command for the given workspace directory", () => {
    const info = mcpInfo("/home/me/my-workspace");
    expect(info.command).toBe("claude mcp add logicspec -- logicspec mcp /home/me/my-workspace");
  });

  it("lists all seven MCP tools", () => {
    const info = mcpInfo("/tmp/x");
    expect(info.tools.map((t) => t.name)).toEqual([
      "list_features",
      "get_feature",
      "get_step",
      "get_transitions",
      "get_service_dependencies",
      "get_events",
      "validate_feature",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/mcp-info.test.ts`
Expected: FAIL — `src/server/mcp-info.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/mcp-info.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/mcp-info.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing HTTP test**

```ts
// tests/server/api-mcp.test.ts
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let base: string;

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/mcp", () => {
  it("returns the registration command and tool list", async () => {
    const res = await fetch(`${base}/api/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { command: string; tools: unknown[] };
    expect(body.command).toContain("logicspec mcp");
    expect(body.command).toContain(BOOKING);
    expect(body.tools).toHaveLength(7);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/server/api-mcp.test.ts`
Expected: FAIL — route doesn't exist yet.

- [ ] **Step 7: Add the route**

In `src/server/create-server.ts`, add the import:

```ts
import { mcpInfo } from "./mcp-info.js";
```

Add, alongside the `/api/features` block:

```ts
    if (url.pathname === "/api/mcp") {
      sendJson(res, mcpInfo(workspaceDir));
      return;
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/server/api-mcp.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npm run lint:fix`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/server/mcp-info.ts src/server/create-server.ts tests/server/mcp-info.test.ts tests/server/api-mcp.test.ts
git commit -m "feat: add GET /api/mcp"
```

---

### Task 5: Tailwind + shadcn/ui setup

**Files:**
- Create: `client/src/index.css`, `client/components.json`, `client/src/lib/utils.ts`
- Modify: `client/vite.config.ts`, `client/src/main.tsx`, `package.json` (devDependencies)

**Interfaces:**
- Produces: `cn(...classes)` utility at `client/src/lib/utils.ts`, a working Tailwind build, shadcn components landing under `client/src/components/ui/`.

- [ ] **Step 1: Add Tailwind and shadcn's runtime dependencies**

```json
"devDependencies": {
  "@tailwindcss/vite": "^4.0.0",
  "class-variance-authority": "^0.7.0",
  "clsx": "^2.1.1",
  "lucide-react": "^0.460.0",
  "tailwind-merge": "^2.5.4",
  "tailwindcss": "^4.0.0"
}
```

(Merge alphabetically into the existing `devDependencies` block from Task 1.)

Run: `npm install`

- [ ] **Step 2: Add the Tailwind Vite plugin**

In `client/vite.config.ts`, add the import and plugin:

```ts
import tailwindcss from "@tailwindcss/vite";
```

```ts
  plugins: [react(), tailwindcss()],
```

- [ ] **Step 3: Write `client/src/index.css`**

```css
/* client/src/index.css */
@import "tailwindcss";

:root {
  --radius: 0.5rem;
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --warning: 38 92% 50%;
  --success: 142 71% 45%;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 6%;
    --card-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --border: 240 3.7% 15.9%;
  }
}

body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
```

- [ ] **Step 4: Write `client/src/lib/utils.ts` (the `cn` helper every shadcn component imports)**

```ts
// client/src/lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Write `client/components.json` (shadcn CLI config — non-interactive, so `npx shadcn add` never prompts)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 6: Add the shadcn components used by this rewrite**

Run (from the repo root, `client/components.json` is picked up via `--cwd`):

```bash
npx shadcn@latest add button badge card table tabs select --cwd client --yes
```

Expected: `client/src/components/ui/{button,badge,card,table,tabs,select}.tsx` are created, and shadcn adds `@radix-ui/react-tabs`/`@radix-ui/react-select` (whatever each component needs) to `package.json` `devDependencies` automatically.

If the command fails or the registry is unreachable, create the six files by hand using shadcn's `new-york` style source for `button`, `badge`, `card`, `table`, `tabs`, `select` — they are standard, unmodified copies; do not invent custom variants.

- [ ] **Step 7: Import the stylesheet**

In `client/src/main.tsx`, add at the top:

```ts
import "./index.css";
```

- [ ] **Step 8: Verify the build still works**

Run: `npm run build`
Expected: PASS, `dist/server/public/assets/*.css` now includes Tailwind's generated utility classes.

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck && npm run lint:fix`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A client package.json package-lock.json
git commit -m "feat: add Tailwind + shadcn/ui to the dashboard client"
```

---

### Task 6: Router + `FeatureList` page

**Files:**
- Create: `client/src/lib/router.tsx`, `client/src/pages/FeatureList.tsx`
- Modify: `client/src/main.tsx`
- Test: `tests/client/router.test.ts` (root-level `tests/client/`, run via `client`'s own Vitest config — see Task 5's sibling note below)

**Interfaces:**
- Produces: `useRoute(): Route` hook where `Route = { name: "list" } | { name: "detail"; id: string } | { name: "mcp" } | { name: "not-found" }`; `navigate(path: string): void`.
- Consumes: `GET /api/features` (Task 2).

Because `client/` has no `package.json`, its tests run through a **second Vitest config at the repo root**, `vitest.client.config.ts`, so `npm test` can cover both without needing a nested package.

- [ ] **Step 1: Add a client Vitest config and wire it into `npm test`**

```ts
// vitest.client.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/client/**/*.test.ts"],
    environment: "node",
  },
});
```

The root `vitest.config.ts`'s `include: ["tests/**/*.test.ts"]` would also match `tests/client/**` — exclude it there so each suite runs under exactly one config:

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/client/**", "**/node_modules/**"],
  },
});
```

In `package.json`, update:

```json
"test": "vitest run && vitest run --config vitest.client.config.ts",
"test:watch": "vitest",
```

- [ ] **Step 2: Write the failing router test**

```ts
// tests/client/router.test.ts
import { describe, expect, it } from "vitest";
import { parseRoute } from "../../client/src/lib/router.js";

describe("parseRoute", () => {
  it("matches the feature list at /", () => {
    expect(parseRoute("/")).toEqual({ name: "list" });
  });

  it("matches a feature detail path, decoding the id", () => {
    expect(parseRoute("/features/my%20feature")).toEqual({ name: "detail", id: "my feature" });
  });

  it("matches /mcp", () => {
    expect(parseRoute("/mcp")).toEqual({ name: "mcp" });
  });

  it("falls back to not-found for anything else", () => {
    expect(parseRoute("/nope")).toEqual({ name: "not-found" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config vitest.client.config.ts tests/client/router.test.ts`
Expected: FAIL — `client/src/lib/router.tsx` does not exist.

- [ ] **Step 4: Write the router**

```tsx
// client/src/lib/router.tsx
import { useEffect, useState } from "react";

export type Route =
  | { name: "list" }
  | { name: "detail"; id: string }
  | { name: "mcp" }
  | { name: "not-found" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/") return { name: "list" };
  if (pathname === "/mcp") return { name: "mcp" };
  const match = /^\/features\/([^/]+)$/.exec(pathname);
  if (match?.[1] !== undefined) return { name: "detail", id: decodeURIComponent(match[1]) };
  return { name: "not-found" };
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Current route, updated on navigation (back/forward and `navigate()` calls). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return route;
}

/** A same-origin link that navigates via the router instead of a full page load. */
export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --config vitest.client.config.ts tests/client/router.test.ts`
Expected: PASS

- [ ] **Step 6: Write `FeatureList`**

```tsx
// client/src/pages/FeatureList.tsx
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/lib/router";

interface FeatureSummary {
  id: string;
  name: string;
  path: string;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  steps: number;
}

function ValidityBadge({ feature }: { feature: FeatureSummary }) {
  if (!feature.valid) {
    return <Badge variant="destructive">{feature.errorCount} error{feature.errorCount === 1 ? "" : "s"}</Badge>;
  }
  if (feature.warningCount > 0) {
    return <Badge variant="secondary">{feature.warningCount} warning{feature.warningCount === 1 ? "" : "s"}</Badge>;
  }
  return <Badge>valid</Badge>;
}

export function FeatureList() {
  const [features, setFeatures] = useState<FeatureSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/features")
      .then((res) => res.json())
      .then((data: FeatureSummary[]) => {
        if (!cancelled) setFeatures(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (features === null) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (features.length === 0) return <p className="p-6 text-muted-foreground">No features found in this workspace.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-6">
      {features.map((feature) => (
        <Card key={feature.id} className="p-4">
          <Link to={`/features/${encodeURIComponent(feature.id)}`} className="text-lg font-semibold hover:underline">
            {feature.name}
          </Link>{" "}
          <ValidityBadge feature={feature} />
          <div className="mt-1 text-xs text-muted-foreground">
            {feature.id} · {feature.path} · {feature.steps} step{feature.steps === 1 ? "" : "s"}
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Mount it from `main.tsx` and add the shared header**

```tsx
// client/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, useRoute } from "@/lib/router";
import { FeatureList } from "@/pages/FeatureList";
import "./index.css";

function App() {
  const route = useRoute();
  return (
    <div>
      <header className="flex items-center gap-4 border-b p-3">
        <Link to="/" className="font-semibold hover:underline">
          LogicSpec Dashboard
        </Link>
        <Link to="/mcp" className="text-sm text-muted-foreground hover:underline">
          MCP
        </Link>
      </header>
      <main>
        {route.name === "list" ? <FeatureList /> : null}
        {route.name === "detail" ? <p className="p-6">Feature detail — coming in Task 7.</p> : null}
        {route.name === "mcp" ? <p className="p-6">MCP page — coming in Task 10.</p> : null}
        {route.name === "not-found" ? <p className="p-6">Not found.</p> : null}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Build and smoke-check**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27010 &`
Then: `curl -s http://127.0.0.1:27010/ | grep -o '<title>[^<]*</title>'`; stop the server (`kill %1` or `pkill -f "dist/cli/main.js serve"`).
Expected: page loads; open it in a real browser to confirm the feature list renders (this is the first real visual milestone).

- [ ] **Step 9: Typecheck, lint, full test suite**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A client tests/client vitest.client.config.ts package.json
git commit -m "feat: add client router and the feature list page"
```

---

### Task 7: `FeatureDetail` page shell (Steps, Source, Inspect, Diagnostics, Related tabs)

**Files:**
- Create: `client/src/pages/FeatureDetail.tsx`, `client/src/pages/feature-detail/StepsTab.tsx`, `client/src/pages/feature-detail/SourceTab.tsx`, `client/src/pages/feature-detail/InspectTab.tsx`, `client/src/pages/feature-detail/DiagnosticsTab.tsx`, `client/src/pages/feature-detail/RelatedTab.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `GET /api/features/:id` (Task 3).
- Produces: each tab component takes the relevant slice of the detail payload as props; `FeatureDetail` owns the fetch and tab state. The Diagram tab is a placeholder here — Tasks 8–9 fill it in.

- [ ] **Step 1: Write the tab components**

```tsx
// client/src/pages/feature-detail/StepsTab.tsx
interface Step {
  id: string;
  type: string;
  label: string;
  actor?: string;
}

export function StepsTab({ steps }: { steps: Step[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">id</th>
          <th className="p-2">type</th>
          <th className="p-2">label</th>
          <th className="p-2">actor</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.id} id={`step-${step.id}`} className="border-b">
            <td className="p-2">{step.id}</td>
            <td className="p-2">{step.type}</td>
            <td className="p-2">{step.label}</td>
            <td className="p-2">{step.actor ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// client/src/pages/feature-detail/SourceTab.tsx
export function SourceTab({ source }: { source: string }) {
  return <pre className="overflow-auto rounded bg-muted p-4 text-xs">{source}</pre>;
}
```

```tsx
// client/src/pages/feature-detail/InspectTab.tsx
export function InspectTab({ inspect }: { inspect: unknown }) {
  return <pre className="overflow-auto rounded bg-muted p-4 text-xs">{JSON.stringify(inspect, null, 2)}</pre>;
}
```

```tsx
// client/src/pages/feature-detail/DiagnosticsTab.tsx
interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  line?: number;
  column?: number;
}

export function DiagnosticsTab({ diagnostics, path }: { diagnostics: Diagnostic[]; path: string }) {
  if (diagnostics.length === 0) return <p className="p-4 text-muted-foreground">No findings.</p>;
  return (
    <div className="space-y-2">
      {diagnostics.map((d, i) => (
        <div
          key={i}
          className={`border-l-4 p-3 ${d.severity === "error" ? "border-destructive" : d.severity === "warning" ? "border-yellow-500" : "border-muted"}`}
        >
          <strong>{d.code}</strong> {d.severity} — {d.message}
          <div className="text-xs text-muted-foreground">
            {path}
            {d.line !== undefined ? `:${d.line}:${d.column}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// client/src/pages/feature-detail/RelatedTab.tsx
import { Link } from "@/lib/router";

interface RelatedRef {
  id: string;
  name: string;
  known: boolean;
}

interface RelatedEvent {
  event: string;
  direction: "publish" | "wait";
  feature: RelatedRef;
}

interface Related {
  subflows: RelatedRef[];
  dependents: RelatedRef[];
  events: RelatedEvent[];
}

function RefList({ refs }: { refs: RelatedRef[] }) {
  if (refs.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="list-disc pl-5 text-sm">
      {refs.map((r) => (
        <li key={r.id}>
          {r.known ? (
            <Link to={`/features/${encodeURIComponent(r.id)}`} className="hover:underline">
              {r.name}
            </Link>
          ) : (
            <>
              {r.name} <span className="text-muted-foreground">(not found in this workspace)</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RelatedTab({ related }: { related: Related }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 font-semibold">Subflows called</h3>
        <RefList refs={related.subflows} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Dependents (call this as a subflow)</h3>
        <RefList refs={related.dependents} />
      </div>
      <div>
        <h3 className="mb-1 font-semibold">Shared events</h3>
        {related.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {related.events.map((e, i) => (
              <li key={i}>
                <strong>{e.event}</strong> —{" "}
                <Link to={`/features/${encodeURIComponent(e.feature.id)}`} className="hover:underline">
                  {e.feature.name}
                </Link>{" "}
                {e.direction === "wait" ? "waits for it" : "publishes it"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `FeatureDetail`**

```tsx
// client/src/pages/FeatureDetail.tsx
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "@/lib/router";
import { DiagnosticsTab } from "./feature-detail/DiagnosticsTab";
import { InspectTab } from "./feature-detail/InspectTab";
import { RelatedTab } from "./feature-detail/RelatedTab";
import { SourceTab } from "./feature-detail/SourceTab";
import { StepsTab } from "./feature-detail/StepsTab";

export interface FeatureDetailData {
  id: string;
  name: string;
  path: string;
  source: string;
  valid: boolean;
  diagnostics: Array<{ code: string; severity: string; message: string; line?: number; column?: number }>;
  diagram?: {
    steps: Array<{ id: string; type: string; label: string; actor?: string; requires?: string[]; produces?: string[] }>;
    edges: Array<{ from: string; to: string; kind: string; label?: string }>;
    actors: Array<{ id: string; label: string }>;
    mermaid: Record<string, string>;
    clickMap: Record<string, { stepId: string; flow?: string }>;
  };
  inspect?: { feature: string };
  related: {
    subflows: Array<{ id: string; name: string; known: boolean }>;
    dependents: Array<{ id: string; name: string; known: boolean }>;
    events: Array<{ event: string; direction: "publish" | "wait"; feature: { id: string; name: string; known: boolean } }>;
  };
}

export function FeatureDetail({ id }: { id: string }) {
  const [data, setData] = useState<FeatureDetailData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/features/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((body: FeatureDetailData) => {
        if (!cancelled) setData(body);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (data === null) return <p className="p-6 text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <Link to="/" className="text-sm hover:underline">
        &larr; Dashboard
      </Link>
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        {data.name}
        <Badge variant={data.valid ? "default" : "destructive"}>{data.valid ? "valid" : "invalid"}</Badge>
      </h1>
      <p className="text-xs text-muted-foreground">
        {data.id} · {data.path}
      </p>
      <Tabs defaultValue="diagram">
        <TabsList>
          <TabsTrigger value="diagram">Diagram</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="related">Related</TabsTrigger>
        </TabsList>
        <TabsContent value="diagram">
          {data.diagram === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <p className="p-4 text-muted-foreground">Diagram view — coming in Tasks 8–9.</p>
          )}
        </TabsContent>
        <TabsContent value="steps">
          {data.diagram === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <StepsTab steps={data.diagram.steps} />
          )}
        </TabsContent>
        <TabsContent value="source">
          <SourceTab source={data.source} />
        </TabsContent>
        <TabsContent value="inspect">
          {data.inspect === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <InspectTab inspect={data.inspect} />
          )}
        </TabsContent>
        <TabsContent value="diagnostics">
          <DiagnosticsTab diagnostics={data.diagnostics} path={data.path} />
        </TabsContent>
        <TabsContent value="related">
          <RelatedTab related={data.related} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `main.tsx`**

In `client/src/main.tsx`, add the import:

```ts
import { FeatureDetail } from "@/pages/FeatureDetail";
```

Replace:

```tsx
        {route.name === "detail" ? <p className="p-6">Feature detail — coming in Task 7.</p> : null}
```

with:

```tsx
        {route.name === "detail" ? <FeatureDetail id={route.id} /> : null}
```

- [ ] **Step 4: Build and manually verify**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27011 --open`
In the browser: click into "Booking", confirm Steps/Source/Inspect/Diagnostics/Related tabs all show real data, Related shows the `BookingCreated` link to Booking Notification. Stop the server.

- [ ] **Step 5: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A client
git commit -m "feat: add the feature detail page (Steps/Source/Inspect/Diagnostics/Related)"
```

---

### Task 8: Mermaid diagram views (bundled by Vite)

**Files:**
- Create: `client/src/pages/feature-detail/DiagramTab.tsx`, `client/src/pages/feature-detail/MermaidView.tsx`
- Modify: `client/src/pages/FeatureDetail.tsx`, `package.json` (devDependency)

**Interfaces:**
- Produces: `<DiagramTab diagram={data.diagram} />` — a view-switcher (`Select`) between `interactive` (placeholder until Task 9) and the four Mermaid views.
- Consumes: `data.diagram.mermaid[view]` (mermaid text, already computed server-side — Task 3).

- [ ] **Step 1: Add `mermaid` as a client-only devDependency**

```json
"devDependencies": {
  "mermaid": "^11.0.0"
}
```

Run: `npm install`

- [ ] **Step 2: Write `MermaidView`**

```tsx
// client/src/pages/feature-detail/MermaidView.tsx
import mermaid from "mermaid";
import { useEffect, useRef } from "react";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

export function MermaidView({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || source === "") return;
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, source).then(({ svg }) => {
      if (!cancelled) el.innerHTML = svg;
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return <div ref={ref} className="overflow-auto" />;
}
```

- [ ] **Step 3: Write `DiagramTab`**

```tsx
// client/src/pages/feature-detail/DiagramTab.tsx
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MermaidView } from "./MermaidView";

const VIEWS = ["interactive", "flow", "swimlane", "sequence", "event-model"] as const;
type View = (typeof VIEWS)[number];

export interface DiagramData {
  steps: Array<{ id: string; type: string; label: string; actor?: string; requires?: string[]; produces?: string[] }>;
  edges: Array<{ from: string; to: string; kind: string; label?: string }>;
  actors: Array<{ id: string; label: string }>;
  mermaid: Record<string, string>;
  clickMap: Record<string, { stepId: string; flow?: string }>;
}

export function DiagramTab({ diagram }: { diagram: DiagramData }) {
  const [view, setView] = useState<View>("interactive");

  return (
    <div className="space-y-3">
      <Select value={view} onValueChange={(v) => setView(v as View)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VIEWS.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {view === "interactive" ? (
        <p className="p-4 text-muted-foreground">Interactive canvas — coming in Task 9.</p>
      ) : (
        <MermaidView source={diagram.mermaid[view] ?? ""} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `FeatureDetail`**

In `client/src/pages/FeatureDetail.tsx`, add the import:

```ts
import { DiagramTab } from "./feature-detail/DiagramTab";
```

Replace:

```tsx
        <TabsContent value="diagram">
          {data.diagram === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <p className="p-4 text-muted-foreground">Diagram view — coming in Tasks 8–9.</p>
          )}
        </TabsContent>
```

with:

```tsx
        <TabsContent value="diagram">
          {data.diagram === undefined ? (
            <p className="p-4 text-muted-foreground">Spec is invalid — see the Diagnostics tab.</p>
          ) : (
            <DiagramTab diagram={data.diagram} />
          )}
        </TabsContent>
```

- [ ] **Step 5: Build and manually verify**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27012 --open`
In the browser: open "Booking", Diagram tab, switch the Select to "flow" — the Mermaid flowchart should render as SVG. Try "sequence" and "event-model" too. Stop the server.

- [ ] **Step 6: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A client package.json package-lock.json
git commit -m "feat: render Mermaid diagram views client-side (mermaid bundled by Vite)"
```

---

### Task 9: Interactive canvas (ported from the VS Code webview)

**Files:**
- Create: `client/src/pages/feature-detail/Canvas.tsx`
- Modify: `client/src/pages/feature-detail/DiagramTab.tsx`, `package.json` (devDependencies)

**Interfaces:**
- Consumes: `diagram.steps`, `diagram.edges`, `diagram.actors`, `diagram.clickMap` (all already in the API response from Task 3).
- Produces: `<Canvas steps={...} edges={...} actors={...} clickMap={...} onNavigate={(featureId) => void} />`.

This ports `integrations/vscode/src/webview/canvas.tsx` almost line-for-line. Two changes from the source: data arrives as props instead of a `postMessage` listener (the `acquireVsCodeApi` bridge is deleted entirely), and node clicks use the click-map to either navigate (subflow steps) or scroll to the matching Steps-tab row (everything else) instead of posting `nodeDetails`/`nodeClick` messages.

- [ ] **Step 1: Add the canvas dependencies**

```json
"devDependencies": {
  "@dagrejs/dagre": "^3.1.1",
  "@xyflow/react": "^12.11.2"
}
```

Run: `npm install`

- [ ] **Step 2: Write `Canvas.tsx`**

```tsx
// client/src/pages/feature-detail/Canvas.tsx
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { navigate } from "@/lib/router";

interface CanvasStep {
  id: string;
  label: string;
  type: string;
  actor?: string;
  requires?: string[];
  produces?: string[];
}

interface CanvasEdge {
  from: string;
  to: string;
  label?: string;
  kind: string;
}

interface CanvasActor {
  id: string;
  label: string;
}

interface ClickTarget {
  stepId: string;
  flow?: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 64;

/** Stable, theme-friendly color per actor: hash → hue, fixed sat/lightness. */
export function actorColor(actorId: string): string {
  let hash = 0;
  for (let i = 0; i < actorId.length; i++) {
    hash = (hash * 31 + actorId.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 62% 46%)`;
}

const NO_ACTOR_COLOR = "hsl(0 0% 55%)";

export function layout(steps: CanvasStep[], edges: CanvasEdge[]): Node[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 42, ranksep: 64 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const step of steps) {
    graph.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (steps.some((s) => s.id === edge.from) && steps.some((s) => s.id === edge.to)) {
      graph.setEdge(edge.from, edge.to);
    }
  }
  dagre.layout(graph);
  return steps.map((step) => {
    const position = graph.node(step.id);
    return {
      id: step.id,
      type: "step",
      position: {
        x: (position?.x ?? 0) - NODE_WIDTH / 2,
        y: (position?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: { ...step },
    } satisfies Node;
  });
}

function StepNode({ data }: NodeProps): ReactElement {
  const step = data as unknown as CanvasStep;
  const color = step.actor ? actorColor(step.actor) : NO_ACTOR_COLOR;
  return (
    <div className={`ls-node ls-${step.type}`} style={{ borderLeftColor: color }}>
      <Handle type="target" position={Position.Top} />
      <div className="ls-head">
        <span className="ls-type">{step.type.toUpperCase()}</span>
        {step.actor ? (
          <span className="ls-actor" style={{ background: color }}>
            {step.actor}
          </span>
        ) : null}
      </div>
      <div className="ls-label">{step.label}</div>
      {(step.requires?.length ?? 0) > 0 || (step.produces?.length ?? 0) > 0 ? (
        <div className="ls-context">
          {(step.requires ?? []).map((name) => (
            <span key={`r-${name}`} className="ls-chip ls-requires" title={`requires ${name}`}>
              ↓{name}
            </span>
          ))}
          {(step.produces ?? []).map((name) => (
            <span key={`p-${name}`} className="ls-chip ls-produces" title={`produces ${name}`}>
              ↑{name}
            </span>
          ))}
        </div>
      ) : null}
      {step.type !== "final" ? <Handle type="source" position={Position.Bottom} /> : null}
    </div>
  );
}

const nodeTypes = { step: StepNode };

export interface CanvasProps {
  steps: CanvasStep[];
  edges: CanvasEdge[];
  actors: CanvasActor[];
  clickMap: Record<string, ClickTarget>;
}

export function Canvas({ steps, edges, actors, clickMap }: CanvasProps): ReactElement {
  const [nodes, setNodes] = useState<Node[]>(() => layout(steps, edges));
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredActor, setHoveredActor] = useState<string | null>(null);

  // Re-layout when `steps`/`edges` change — not just on first mount. Without
  // this, live reload (Task 11) would leave the canvas showing stale data:
  // React reuses this component instance across prop updates, so a plain
  // lazy `useState` initializer alone only ever runs once.
  useEffect(() => {
    setNodes(layout(steps, edges));
  }, [steps, edges]);

  const related = useMemo(() => {
    if (hoveredActor !== null) {
      const set = new Set<string>();
      for (const node of nodes) {
        if ((node.data as unknown as CanvasStep).actor === hoveredActor) set.add(node.id);
      }
      return set;
    }
    if (hovered === null) return null;
    const set = new Set<string>([hovered]);
    for (const edge of edges) {
      if (edge.from === hovered) set.add(edge.to);
      if (edge.to === hovered) set.add(edge.from);
    }
    return set;
  }, [hovered, hoveredActor, nodes, edges]);

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        className: related !== null && !related.has(node.id) ? "ls-dim" : undefined,
      })),
    [nodes, related],
  );

  const displayEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => {
        const isFocus =
          related !== null &&
          (hoveredActor !== null
            ? related.has(edge.from) && related.has(edge.to)
            : edge.from === hovered || edge.to === hovered);
        const dimmed = related !== null && !isFocus;
        return {
          id: `e${index}`,
          source: edge.from,
          target: edge.to,
          label: edge.label,
          animated: edge.kind === "event" && !dimmed,
          className: dimmed ? "ls-dim" : isFocus ? "ls-focus" : undefined,
          style: {
            strokeDasharray: edge.kind === "event" ? "5 4" : undefined,
            strokeWidth: isFocus ? 2.5 : 1.5,
          },
          labelStyle: { fontSize: 10, opacity: dimmed ? 0.15 : 1 },
          markerEnd: { type: "arrowclosed" as const },
        };
      }),
    [edges, related, hovered, hoveredActor],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)),
    [],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: Node) => {
      const target = clickMap[node.id];
      if (target === undefined) return;
      if (target.flow !== undefined) {
        navigate(`/features/${encodeURIComponent(target.flow)}`);
        return;
      }
      const tabTrigger = document.querySelector<HTMLElement>('[data-tab-trigger="steps"]');
      tabTrigger?.click();
      const row = document.getElementById(`step-${target.stepId}`);
      row?.scrollIntoView({ block: "center" });
    },
    [clickMap],
  );

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeMouseEnter={(_event, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onNodeClick={onNodeClick}
      fitView
      minZoom={0.15}
      maxZoom={4}
      style={{ height: 600 }}
    >
      <Background gap={18} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const actor = (node.data as unknown as CanvasStep).actor;
          return actor ? actorColor(actor) : NO_ACTOR_COLOR;
        }}
      />
      {actors.length > 0 ? (
        <Panel position="top-left" className="ls-legend">
          {actors.map((actor) => (
            <div
              key={actor.id}
              className="ls-legend-item"
              onMouseEnter={() => setHoveredActor(actor.id)}
              onMouseLeave={() => setHoveredActor(null)}
            >
              <span className="ls-swatch" style={{ background: actorColor(actor.id) }} />
              {actor.label}
            </div>
          ))}
        </Panel>
      ) : null}
    </ReactFlow>
  );
}
```

- [ ] **Step 3: Copy the node/legend styling from the VS Code webview**

Append to `client/src/index.css` (after the existing `:root`/dark-mode blocks) — ported from `integrations/vscode/media/preview.css`'s `/* ── Interactive canvas ── */` section, with `--vscode-*` theme variables swapped for this app's own `--card`/`--border`/`--foreground`/`--destructive`/`--primary` tokens:

```css
#canvas {
  flex: 1;
  min-height: 0;
}

.ls-node {
  width: 200px;
  box-sizing: border-box;
  padding: 0.4rem 0.55rem 0.45rem;
  border: 1px solid hsl(var(--border));
  border-left-width: 4px;
  border-radius: 6px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: opacity 0.15s ease, box-shadow 0.15s ease;
}

.ls-node:hover {
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}

.ls-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.15rem;
}

.ls-type {
  font-size: 0.58rem;
  letter-spacing: 0.07em;
  opacity: 0.65;
}

.ls-actor {
  margin-left: auto;
  padding: 0.02rem 0.35rem;
  border-radius: 999px;
  color: #fff;
  font-size: 0.6rem;
}

.ls-label {
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
}

.ls-context {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  margin-top: 0.25rem;
}

.ls-chip {
  padding: 0 0.3rem;
  border-radius: 3px;
  font-size: 0.58rem;
  font-family: monospace;
  background: rgba(128, 128, 128, 0.18);
  opacity: 0.9;
}

.ls-error .ls-label {
  color: hsl(var(--destructive));
}

.ls-final {
  border-style: double;
  border-width: 3px 3px 3px 4px;
}

.react-flow__node.ls-dim {
  opacity: 0.12;
  pointer-events: none;
}

.react-flow__edge.ls-dim {
  opacity: 0.08;
}

.react-flow__edge.ls-focus path {
  stroke: hsl(var(--primary));
}

.ls-legend {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--card));
  font-size: 0.72rem;
}

.ls-legend-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: default;
}

.ls-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  display: inline-block;
}
```

- [ ] **Step 4: Add the `data-tab-trigger` attribute the canvas click handler needs**

In `client/src/pages/FeatureDetail.tsx`, add `data-tab-trigger="steps"` to the Steps `TabsTrigger`:

```tsx
          <TabsTrigger value="steps" data-tab-trigger="steps">
            Steps
          </TabsTrigger>
```

- [ ] **Step 5: Wire `Canvas` into `DiagramTab`**

In `client/src/pages/feature-detail/DiagramTab.tsx`, add the import:

```ts
import { Canvas } from "./Canvas";
```

Replace:

```tsx
      {view === "interactive" ? (
        <p className="p-4 text-muted-foreground">Interactive canvas — coming in Task 9.</p>
      ) : (
```

with:

```tsx
      {view === "interactive" ? (
        <Canvas
          steps={diagram.steps}
          edges={diagram.edges}
          actors={diagram.actors}
          clickMap={diagram.clickMap}
        />
      ) : (
```

- [ ] **Step 6: Build and manually verify**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27013 --open`
In the browser: Diagram tab, "interactive" (default). Confirm: nodes are draggable, minimap/zoom/pan controls work, hovering a step dims unrelated nodes/edges, the actor legend highlights on hover. `examples/booking` has no subflow step, so subflow-navigation can't be checked here — note that as a follow-up manual check against a workspace that has one (e.g. one of the `examples/` added in 0.10.0). Stop the server.

- [ ] **Step 7: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A client package.json package-lock.json
git commit -m "feat: port the interactive diagram canvas from the VS Code webview"
```

---

### Task 10: MCP info page

**Files:**
- Create: `client/src/pages/McpInfo.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `GET /api/mcp` (Task 4).

- [ ] **Step 1: Write `McpInfo`**

```tsx
// client/src/pages/McpInfo.tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
  const [data, setData] = useState<McpInfoData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mcp")
      .then((res) => res.json())
      .then((body: McpInfoData) => {
        if (!cancelled) setData(body);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === null) return <p className="p-6 text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">MCP Server</h1>
      <p className="text-sm text-muted-foreground">
        Register this workspace with an MCP client (e.g. Claude Code):
      </p>
      <div className="flex items-center gap-2">
        <pre className="flex-1 overflow-auto rounded bg-muted p-3 text-xs">{data.command}</pre>
        <Button
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(data.command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
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
```

- [ ] **Step 2: Wire it into `main.tsx`**

In `client/src/main.tsx`, add the import:

```ts
import { McpInfo } from "@/pages/McpInfo";
```

Replace:

```tsx
        {route.name === "mcp" ? <p className="p-6">MCP page — coming in Task 10.</p> : null}
```

with:

```tsx
        {route.name === "mcp" ? <McpInfo /> : null}
```

- [ ] **Step 3: Build and manually verify**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27014 --open`
Click "MCP" in the header. Confirm the command shows the real workspace path, Copy works, all 7 tools are listed. Stop the server.

- [ ] **Step 4: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A client
git commit -m "feat: add the MCP server info page"
```

---

### Task 11: Live reload without a full page reload

**Files:**
- Create: `client/src/lib/liveReload.ts`
- Modify: `client/src/main.tsx`, `client/src/pages/FeatureList.tsx`, `client/src/pages/FeatureDetail.tsx`, `client/src/pages/McpInfo.tsx`
- Test: `tests/client/liveReload.test.ts`

**Interfaces:**
- Produces: `useLiveReload(onReload: () => void): void` — subscribes to `/events` once, calls `onReload` on every SSE message.

- [ ] **Step 1: Write the failing test**

```ts
// tests/client/liveReload.test.ts
import { describe, expect, it, vi } from "vitest";
import { parseSseData } from "../../client/src/lib/liveReload.js";

describe("parseSseData", () => {
  it("extracts the data payload from one SSE frame", () => {
    expect(parseSseData("data: reload\n\n")).toBe("reload");
  });

  it("returns undefined for a frame with no data line", () => {
    expect(parseSseData("\n")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.client.config.ts tests/client/liveReload.test.ts`
Expected: FAIL — `client/src/lib/liveReload.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// client/src/lib/liveReload.ts
import { useEffect, useRef } from "react";

/** Pure parsing helper, tested without a real EventSource. */
export function parseSseData(frame: string): string | undefined {
  const match = /^data: (.*)$/m.exec(frame);
  return match?.[1];
}

/** Subscribes to the dashboard's SSE endpoint once; calls `onReload` on every message. */
export function useLiveReload(onReload: () => void): void {
  const callback = useRef(onReload);
  callback.current = onReload;

  useEffect(() => {
    const source = new EventSource("/events");
    source.onmessage = () => callback.current();
    return () => source.close();
  }, []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.client.config.ts tests/client/liveReload.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into each page's fetch**

In `client/src/pages/FeatureList.tsx`, add the import:

```ts
import { useLiveReload } from "@/lib/liveReload";
```

Replace the existing data-loading `useEffect`:

```tsx
  useEffect(() => {
    let cancelled = false;
    fetch("/api/features")
      .then((res) => res.json())
      .then((data: FeatureSummary[]) => {
        if (!cancelled) setFeatures(data);
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

with:

```tsx
  const load = () => {
    fetch("/api/features")
      .then((res) => res.json())
      .then((data: FeatureSummary[]) => setFeatures(data));
  };

  useEffect(load, []);
  useLiveReload(load);
```

In `client/src/pages/FeatureDetail.tsx`, add the same import, then replace:

```tsx
  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/features/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((body: FeatureDetailData) => {
        if (!cancelled) setData(body);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
```

with:

```tsx
  const load = () => {
    fetch(`/api/features/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((body: FeatureDetailData) => setData(body));
  };

  useEffect(() => {
    setData(null);
    load();
  }, [id]);
  useLiveReload(load);
```

In `client/src/pages/McpInfo.tsx`, add the same import, then replace:

```tsx
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mcp")
      .then((res) => res.json())
      .then((body: McpInfoData) => {
        if (!cancelled) setData(body);
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

with:

```tsx
  const load = () => {
    fetch("/api/mcp")
      .then((res) => res.json())
      .then((body: McpInfoData) => setData(body));
  };

  useEffect(load, []);
  useLiveReload(load);
```

All three drop their `cancelled` guard — `useLiveReload`'s callback-ref pattern (Step 3) already always calls the *latest* `load`, and a component unmounting mid-fetch just means a harmless `setState` on an unmounted component is never reached because `load` itself isn't re-invoked after unmount (only re-renders were guarding against, not needed here since there's no cross-render race — each `load()` call's own promise chain still resolves once, matching the single in-flight request these pages make at a time).

- [ ] **Step 6: Build and manually verify**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27015 --open`
With the feature list open, edit `examples/booking/booking.feature.yaml` (add a trailing comment), save, revert. Confirm the list refetches without a full-page flash (Network tab shows a new `/api/features` request, no full navigation). Stop the server.

- [ ] **Step 7: Typecheck, lint, test**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A client tests/client
git commit -m "feat: live-reload via data refetch instead of a full page reload"
```

---

### Task 12: Retire the `mermaidAssetPath` override (mermaid is bundled now)

**Files:**
- Delete: `src/server/assets.ts`, `tests/server/assets.test.ts`
- Modify: `src/server/create-server.ts`, `integrations/vscode/src/dashboard.ts`, `package.json`

**Interfaces:**
- `DashboardServerOptions` loses its `mermaidAssetPath` field — it's now `{}` (kept as an interface for forward compatibility, but with no members yet).

- [ ] **Step 1: Remove the `/assets/mermaid.min.js` route and the option from `create-server.ts`**

Remove the import:

```ts
import { defaultMermaidAssetPath } from "./assets.js";
```

Remove:

```ts
  /** Overrides the default `node_modules/mermaid` resolution (VS Code passes its own). */
  mermaidAssetPath?: string;
```

so `DashboardServerOptions` is:

```ts
export interface DashboardServerOptions {}
```

Remove:

```ts
  const mermaidAssetPath = options.mermaidAssetPath ?? defaultMermaidAssetPath();
```

Remove the whole block:

```ts
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
```

- [ ] **Step 2: Delete `assets.ts` and its test**

```bash
rm src/server/assets.ts tests/server/assets.test.ts
```

- [ ] **Step 3: Simplify the VS Code "Start Dashboard" wiring**

In `integrations/vscode/src/dashboard.ts`, remove the `mermaidAssetPath` construction and its use:

```ts
  const mermaidAssetPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "mermaid.min.js",
  ).fsPath;
  const server = createDashboardServer(startDir, { mermaidAssetPath });
```

becomes:

```ts
  const server = createDashboardServer(startDir);
```

- [ ] **Step 4: Move `mermaid` out of root `dependencies`**

In `package.json`, remove `"mermaid": "^11.0.0"` from `"dependencies"` (it now lives only in `devDependencies`, added in Task 8).

Run: `npm install`

- [ ] **Step 5: Typecheck, lint, run the full server and CLI test suites**

Run: `npm run typecheck && npm run lint:fix && npm test`
Expected: PASS — no leftover references to `defaultMermaidAssetPath`/`assets.js`.

- [ ] **Step 6: Verify the VS Code extension still typechecks and builds**

```bash
cd integrations/vscode
npm run typecheck && npm run build && npm test
cd ../..
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/server integrations/vscode package.json package-lock.json tests/server
git commit -m "chore: retire the mermaidAssetPath override, mermaid is bundled by Vite now"
```

---

### Task 13: Full verification, docs, and CHANGELOG

**Files:**
- Modify: `docs/integrations.md`, `README.md`, `CHANGELOG.md`, `package.json` (version)

**Interfaces:** None (verification and docs only).

- [ ] **Step 1: Full root test suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 2: Booking example still validates**

Run: `npm run build && node dist/cli/main.js validate examples/booking`
Expected: exit code `0`.

- [ ] **Step 3: VS Code integration checks**

```bash
cd integrations/vscode
npm run typecheck && npm run build && npm test
cd ../..
```

Expected: PASS.

- [ ] **Step 4: Manual end-to-end walkthrough**

`node dist/cli/main.js serve examples/booking --open`. Confirm: feature list, both feature detail pages (all 6 tabs, including live Mermaid + interactive canvas), MCP page, live-reload-without-flash on save. Also start it from VS Code's "LogicSpec: Start Dashboard" command (or the Activity Bar Features view's title-bar button) and confirm the same experience there.

- [ ] **Step 5: Update `docs/integrations.md`'s dashboard section**

Replace the current "## Dashboard server" paragraph (which describes server-rendered HTML) with:

```markdown
## Dashboard server

`logicspec serve [dir]` runs a local dashboard at `http://127.0.0.1:27000` by default (`--port`, `--host`, `--open`) — a React single-page app (Vite, shadcn/ui) served by a small JSON API. Every feature is listed and clickable; each detail page has a diagram tab (an interactive drag/zoom/pan canvas by default — the same experience as the VS Code preview's interactive view — plus the four Mermaid views), raw source, the `inspect` model, diagnostics, and cross-feature links (subflow calls, dependents, shared events). An MCP page shows the registration command and tool table for AI agents. Live-reloads on every save via Server-Sent Events, without a full page refresh. No editing — for that, use the visual editor below.
```

- [ ] **Step 6: Update the README's `logicspec serve` section**

In `README.md`, find the `### \`logicspec serve [dir]\`` section and replace its body with:

```markdown
Runs a local dashboard — a React single-page app served by a small JSON API: every feature listed and clickable, each with a full-detail page (an interactive drag/zoom/pan diagram canvas plus the four Mermaid views, raw YAML source, the same stable model `inspect --json` returns, validation diagnostics, cross-references, and an MCP registration page). Defaults to `http://127.0.0.1:27000`; `--port`, `--host` and `--open` override the defaults. Live-reloads on every save.
```

- [ ] **Step 7: Bump the version and write the CHANGELOG entry**

In `package.json`, bump `"version"` from `0.11.0` to `0.12.0` (a minor bump — this is a user-facing rewrite of an existing feature, not a patch). If the version has since moved past `0.11.0` (another release landed first), bump the minor from whatever the current value is instead — check with `grep '"version"' package.json`.

In `CHANGELOG.md`, add above the current top entry:

```markdown
## <new version>

**Dashboard rewrite: a real React app.** `logicspec serve`'s dashboard is now
a single-page app (Vite, shadcn/ui) instead of server-rendered HTML — same
URLs, same CLI/VS Code entry points, no DSL or API changes.

- **Interactive diagram canvas** as the default Diagram view — drag, zoom,
  pan, hover-spotlight and an actor legend, the same experience already
  shipped in the VS Code preview's interactive view, now available from
  `logicspec serve` too. The four Mermaid views (`flow` | `swimlane` |
  `sequence` | `event-model`) are still available via a switcher.
- **New MCP page** — the `claude mcp add` registration command and the full
  tool table, for the workspace currently being served.
- **Live reload without a full-page refresh** — the SPA refetches the
  current page's data on save instead of reloading the whole page.
- The dashboard's JSON API (`/api/features`, `/api/features/:id`,
  `/api/mcp`) is internal — not part of the public `logicspec` API surface.
- `mermaid` moves back out of `dependencies` (bundled by Vite at build time
  instead of resolved from `node_modules` at request time) — the published
  package's real runtime dependencies are unchanged: `chokidar`,
  `commander`, `yaml`, `zod`.
```

- [ ] **Step 8: Run `npm install` to sync the lockfile with the version bump, then the full checks once more**

Run: `npm install && npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add docs/integrations.md README.md CHANGELOG.md package.json package-lock.json
git commit -m "docs: document the dashboard SPA rewrite; release 0.12.0"
```

(If Step 7 bumped to a different version because `0.11.0` had already moved on, use that version in the commit message instead of `0.12.0`.)
