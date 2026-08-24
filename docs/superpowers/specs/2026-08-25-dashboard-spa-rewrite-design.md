# Dashboard SPA rewrite — design

Date: 2026-08-25

## Goal

Replace the server-rendered HTML dashboard (`docs/superpowers/specs/2026-08-24-dashboard-server-design.md`) with a real single-page React app: a proper interactive diagram canvas (drag/zoom/pan/hover-spotlight — the same experience already proven in the VS Code webview), a shadcn/ui visual design instead of hand-rolled CSS, and an MCP-server info page. `logicspec serve` and the VS Code "Start Dashboard" command both keep working exactly as before from the user's point of view — same URLs, same routes, same live-reload — only the rendering mechanism changes underneath.

## Non-goals

Not editing — still read-only, same as the server-rendered version. Not a separate `integrations/` package — the client ships inside the root `logicspec` package so `npx logicspec serve` keeps working standalone from a plain `npm install`, with no sibling package required.

## Architecture

Client-side rendered only, no SSR. The server's job shrinks to two things: a small JSON API, and serving the built static SPA (HTML shell + JS/CSS bundle) for every non-API route so client-side routing can take over. All LogicSpec-domain computation (validate, normalize, build the graph, render Mermaid text, compute related features, build the click-map) stays server-side exactly as already built — the client has **no dependency on `logicspec` at all**, it only ever calls its own API and renders what comes back. This keeps validation/rendering logic in one place and keeps the client a pure presentation layer.

## Dependency footprint

This is worth being explicit about, since it resolves the tension from the original design: React, `@xyflow/react`, `@dagrejs/dagre`, `mermaid`, Vite, Tailwind and shadcn's Radix/cva/clsx dependencies all become **devDependencies** of the root package, not `dependencies`. Vite bundles all of it into static JS/CSS at build time; none of it needs to exist in `node_modules` at request time. A plain `npm install logicspec` therefore ends up with exactly the same real runtime dependencies as before this feature existed: `chokidar`, `commander`, `yaml`, `zod`. `mermaid` in particular moves *out* of `dependencies` (where the original dashboard design put it) back to devDependency-only, since it's now bundled by Vite instead of resolved from `node_modules` at request time.

## Retires

Real deletions, not just additions — this replaces working, tested code shipped a few hours earlier in this project's history:

- `src/server/html.ts`, `src/server/pages/dashboard.ts`, `src/server/pages/feature-detail.ts` and their tests — the whole server-rendered-HTML templating layer.
- `src/server/assets.ts` and its test — mermaid is bundled by Vite now, not resolved from `node_modules` at request time.
- The `mermaidAssetPath` override on `DashboardServerOptions` and its VS Code-side plumbing in `integrations/vscode/src/dashboard.ts` — no longer needed once mermaid ships inside the same static bundle both the CLI and VS Code already serve identically.
- `mermaid` moves from root `package.json` `dependencies` back out (see above).

Kept as-is: `src/server/data.ts`, `src/server/related.ts`, `src/server/click-map.ts` (the actual domain logic — these become the API's data source, unchanged), the SSE live-reload machinery in `create-server.ts`, `src/workspace/watch.ts`, the CLI command (`src/cli/serve.ts`), and the VS Code Activity Bar Features view (`features-tree.ts`) from the previous sub-project — none of that depends on how the dashboard renders.

## JSON API (`src/server/create-server.ts`)

Replaces the HTML-producing routes:

- `GET /api/features` — every feature: id, name, relative path, validity, error/warning counts, step count. Feeds the feature-list page.
- `GET /api/features/:id` — one feature's full detail: `source` (raw YAML), `diagnostics`, and when valid: `steps` (id/type/label/actor/requires/produces — the shape `canvas.tsx` already expects), `edges` (from/to/kind/label), `actors`, mermaid text for each of the four views (flow/swimlane/sequence/event-model), the node-click-map (unchanged from `click-map.ts`), the `inspect` report, and `related` (unchanged from `related.ts`).
- `GET /api/mcp` — static info: the tool table (name/args/returns — the same seven tools documented in `docs/integrations.md`) and the exact `claude mcp add logicspec -- logicspec mcp <dir>` command, with `<dir>` filled in to the actual workspace path. No live process check — an MCP server runs per-agent-session over stdio, there's nothing running to poll from a browser.
- `GET /events` — unchanged (SSE live-reload).
- `GET /assets/mermaid.min.js` — removed (see Retires).
- Everything else (`GET /`, `GET /features/:id`, `GET /mcp`, any other path) — serves the built `index.html` shell (SPA fallback), so the client router owns the URL.

## `client/` (new directory, sibling to `src/`)

Vite + React 19 + TypeScript, matching `integrations/editor/`'s existing toolchain (same React Flow major version) rather than esbuild — this package benefits from a real hot-reload dev loop the way the editor already does, and there's no reason to introduce a third bundler pattern alongside esbuild (extension) and Vite (editor). Own `tsconfig.json` (DOM lib, JSX, Bundler resolution — incompatible with the root `tsconfig.json`'s Node-only, no-DOM settings, so it cannot share the root config). `vite.config.ts`'s `build.outDir` points straight at `../dist/server/public`, so a plain `vite build` run during `npm run build` puts static assets exactly where `createDashboardServer` serves them from — no separate copy step.

Structure:
- `client/src/main.tsx` — mounts a tiny hand-rolled router (three route shapes only — `/`, `/features/:id`, `/mcp` — not worth a routing library) that reads `location.pathname` and swaps the page component. Navigation is plain `<a>`/`history.pushState`, intercepted so it doesn't trigger a full reload.
- `client/src/pages/FeatureList.tsx` — fetches `/api/features`, renders a shadcn `Card`/`Table` list with a validity `Badge` per row.
- `client/src/pages/FeatureDetail.tsx` — fetches `/api/features/:id`, renders shadcn `Tabs` (Diagram / Steps / Source / Inspect / Diagnostics / Related), each tab a small component. The Diagram tab has its own view-switcher (`Select`): **Interactive** (the ported canvas, default) plus the four Mermaid views (rendered via `mermaid.run()` on the fetched text, same mechanism as before, just inside a React effect instead of a plain script tag).
- `client/src/pages/McpInfo.tsx` — fetches `/api/mcp`, renders the tool table and a copyable command (shadcn `Button` + clipboard).
- `client/src/components/Canvas.tsx` — the port of `integrations/vscode/src/webview/canvas.tsx`: same `@xyflow/react` + dagre layout, same `StepNode` (requires/produces chips, actor color), same hover-spotlight and legend behavior. Two changes from the source: (1) data arrives as props (`steps`, `edges`, `actors` from the already-fetched API response) instead of a `postMessage` listener — the `acquireVsCodeApi`/message-bridge code is deleted entirely; (2) click semantics change since there's no editor to jump to — a subflow-step click navigates to `/features/<flow>` (the router, not a full reload), any other step click opens/scrolls the Steps tab, mirroring exactly what the current click-map already does for the Mermaid views. Markup gets Tailwind utility classes instead of the current `.ls-*` rules in `integrations/vscode/media/preview.css`; visual behavior (colors, spacing, hover dimming) carries over, restyled.
- `client/src/components/ui/` — shadcn components: Button, Badge, Card, Table, Tabs, Select. Copied source (shadcn's model — not an npm dependency), each pulling in whatever Radix primitive and `cva`/`clsx`/`tailwind-merge` it needs.

## Live reload

Client subscribes to `/events` on mount (same SSE endpoint) and, on message, refetches whatever the current page just fetched instead of a hard `location.reload()` — a real improvement over the server-rendered version's full-page reload, and simple now that data-fetching is already centralized per page.

## Build wiring

Root `package.json`:
- `"build"`: `tsc -p tsconfig.build.json && vite build --config client/vite.config.ts` (or a small script — exact form is a plan-time detail; both must run, order doesn't matter since they write to disjoint output paths).
- `"typecheck"`: adds `tsc --noEmit -p client/tsconfig.json`.
- `"lint"`: Biome's target list extends to include `client`.
- `"test"`: server/CLI tests stay under the existing root `vitest.config.ts` (Node environment) unchanged; `client/` gets its own `vitest.config.ts` (jsdom environment, React Testing Library) for the handful of things worth testing there (see Testing) — a separate command, matching how `integrations/editor` and `integrations/vscode` already each run their own `npm test`.

## Testing

- Server: `tests/server/data.test.ts`, `related.test.ts`, `click-map.test.ts` — unchanged, they didn't touch rendering. New `tests/server/api.test.ts` — the real HTTP integration test (same style as the current `create-server.test.ts`) hitting `/api/features`, `/api/features/:id`, `/api/mcp` against `examples/booking`, checking JSON shape and content, plus confirming an unknown path falls back to serving `index.html` (SPA fallback) instead of 404ing.
- Client: matching this codebase's existing convention (`integrations/vscode`'s webview canvas has zero automated tests — "click handling is exercised manually," per its own design doc), automated client tests stay narrow: pure logic only (`actorColor`, the dagre `layout()` function, the tiny router's path-matching) via Vitest + jsdom, no component-rendering tests. Actual UI behavior (drag/zoom/hover, tab switching, live reload) is verified manually against the real built app, same as the VS Code canvas already is.
- End-to-end: after building, `logicspec serve examples/booking` and manually walk through: feature list loads, click into a feature, all tabs render, Interactive view drags/zooms/hovers correctly, clicking a subflow node (once a subflow-containing fixture exists — `examples/booking` doesn't have one, so this specific check needs a workspace that does, e.g. one of the newer `examples/` added in 0.10.0) navigates, MCP page shows the right command, live-reload refetches on save without a full-page flash.

## Rejected alternative

Keeping the server-rendered HTML and only adding a bundled canvas for the Diagram tab (the "two smaller changes" option from the earlier discussion) — smaller blast radius, but explicitly not what was chosen: the user asked for the full rewrite after seeing that trade-off laid out.
