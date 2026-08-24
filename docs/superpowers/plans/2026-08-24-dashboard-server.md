# Local dashboard server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `logicspec serve [dir]` — a read-only local HTTP dashboard listing every feature in a workspace, with a full-detail page per feature (diagram, source, inspect data, diagnostics, cross-references), live-reloading on file change, launchable from the CLI or from a new VS Code command.

**Architecture:** New `src/server/` module (fs-touching tier, alongside `src/workspace/`, `src/cli/`, `src/mcp/`) with plain Node `http` routing and server-rendered HTML — no framework, no client bundler. Every request reloads the workspace from disk (same "correctness over latency" stance as the MCP server), so the dashboard is always current. Diagrams render client-side via the `mermaid` npm package's prebuilt browser bundle; node-click navigation reuses the existing `mermaidNodeIdMap` delegated-click-listener pattern from the VS Code webview (`docs/superpowers/specs/2026-08-10-vscode-clickable-preview-design.md`) instead of Mermaid's `click` directives, which that spec already rejected for requiring `securityLevel: loose`.

**Tech Stack:** TypeScript/ESM/Node ≥20, Node's built-in `http` module, `mermaid` (new root dependency, browser bundle only, no bundler), `chokidar` (already a dependency) for live-reload via Server-Sent Events. VS Code side: existing `esbuild` bundle, existing `mermaid` devDependency (already copied to `media/mermaid.min.js`).

**Spec:** `docs/superpowers/specs/2026-08-24-dashboard-server-design.md`

## Global Constraints

- Node ≥ 20, TypeScript strict/ESM (`NodeNext` module resolution), Biome formatting: double quotes, 2-space indent, 100-char line width.
- Read-only. No editing endpoints, no writes to feature files.
- Renderers (`src/renderers/`) stay untouched — pure, deterministic, byte-identical output. All dashboard-only behavior (link injection, HTML escaping) lives in `src/server/`, never inside a renderer.
- Every YAML-derived string (labels, notes, descriptions, raw source) goes through the new `escapeHtml` helper before landing in generated HTML — a distinct escaping context from the existing `escapeMermaid`; never conflate the two.
- Diagram node click-through reuses `mermaidNodeIdMap` (`src/renderers/mermaid-common.ts`) with a delegated click listener (`event.target.closest("g.node[id]")`, regex `/^flowchart-(.+)-\d+$/`) — the exact pattern already shipped in `integrations/vscode/media/preview.js`. Mermaid stays at `securityLevel: "strict"`. Never use Mermaid's `click` directive.
- The server binds `127.0.0.1` by default — never `0.0.0.0`.
- No new heavy dependency. `mermaid` is added to root `package.json` `dependencies` (not `devDependencies`) because `logicspec serve` reads its prebuilt browser bundle straight from `node_modules` at request time — no bundler step.
- The packaged VS Code extension excludes `node_modules` (`.vscodeignore`), so the dashboard server must accept an injectable `mermaidAssetPath` override; the CLI omits it and resolves its own `node_modules/mermaid`, the VS Code extension passes its already-built `media/mermaid.min.js`.
- CLI commands return a `number` exit code (`EXIT_OK` / `EXIT_VALIDATION` / `EXIT_USAGE` from `src/cli/shared.ts`) and accept `{ cwd?, io? }` for testability, matching every existing command in `src/cli/`.
- Tests mirror `src/` layout under `tests/`. Use `examples/booking` (the canonical workspace) as the real fixture wherever a real feature file is needed instead of fabricating YAML.
- `CLAUDE.md` and `AGENTS.md` document the same CLI surface in the same wording — update both together.

---

### Task 1: Shared workspace-watch helper

**Files:**
- Create: `src/workspace/watch.ts`
- Modify: `src/cli/watch.ts`
- Test: `tests/workspace/watch.test.ts`

**Interfaces:**
- Produces: `watchTargetsFor(workspace: Workspace, startDir: string): string[]`, `watchWorkspace(targets: readonly string[], onEvent: (event: string, file: string) => void, onError: (error: Error) => void): FSWatcher` (from `"chokidar"`).
- Consumes: `Workspace` from `../workspace/loader.js` (existing).

- [ ] **Step 1: Write the failing test**

```ts
// tests/workspace/watch.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../../src/workspace/loader.js";
import { watchTargetsFor } from "../../src/workspace/watch.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("watchTargetsFor", () => {
  it("includes the features directory, config, and configured catalogs", () => {
    const workspace = loadWorkspace(BOOKING);
    const targets = watchTargetsFor(workspace, BOOKING);

    expect(targets).toContain(path.join(BOOKING, "logicspec.config.yaml"));
    expect(targets).toContain(path.join(BOOKING, "services.yaml"));
    expect(targets).toContain(path.join(BOOKING, "events.yaml"));
    expect(targets.some((t) => t === BOOKING)).toBe(true);
  });

  it("falls back to startDir alone without a config", () => {
    const workspace = loadWorkspace(ROOT); // repo root has no logicspec.config.yaml
    const targets = watchTargetsFor(workspace, ROOT);
    expect(targets).toEqual([ROOT]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace/watch.test.ts`
Expected: FAIL — `src/workspace/watch.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/workspace/watch.ts
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Workspace } from "./loader.js";

/**
 * Paths chokidar should watch for a workspace: the features directory plus,
 * when a config was found, the config file and configured catalogs. Falls
 * back to `startDir` itself without a config, matching `watch`'s original
 * "just watch this directory" behavior for config-less usage.
 */
export function watchTargetsFor(workspace: Workspace, startDir: string): string[] {
  const featuresDir =
    workspace.configPath !== undefined
      ? path.resolve(workspace.root, workspace.config.features.directory)
      : startDir;

  const targets = [featuresDir];
  if (workspace.configPath !== undefined) {
    targets.push(workspace.configPath);
    if (workspace.config.catalogs?.services) {
      targets.push(path.resolve(workspace.root, workspace.config.catalogs.services));
    }
    if (workspace.config.catalogs?.events) {
      targets.push(path.resolve(workspace.root, workspace.config.catalogs.events));
    }
  }
  return targets;
}

/**
 * Watches the given paths and invokes `onEvent` for every chokidar change
 * after the initial scan. Shared by `logicspec watch` (re-renders) and
 * `logicspec serve` (live-reload) so both watch exactly the same targets.
 */
export function watchWorkspace(
  targets: readonly string[],
  onEvent: (event: string, file: string) => void,
  onError: (error: Error) => void,
): FSWatcher {
  const watcher = chokidar.watch(targets, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  watcher.on("all", onEvent);
  watcher.on("error", (error) => onError(error as Error));
  return watcher;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace/watch.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor `src/cli/watch.ts` to use the extracted helpers (behavior-preserving)**

Replace the body of `src/cli/watch.ts` with:

```ts
import path from "node:path";
import { FEATURE_FILE_SUFFIX, featureDependents, loadWorkspace } from "../workspace/loader.js";
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
import { runRender } from "./render.js";
import { color, type Io, processIo } from "./report.js";
import { EXIT_OK } from "./shared.js";

export interface WatchCommandOptions {
  cwd?: string;
  io?: Io;
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}

/**
 * `logicspec watch [dir]` — on every change: validate, print diagnostics,
 * and regenerate diagrams only when the source is valid. A previously valid
 * generated diagram is never overwritten by an invalid one because render
 * refuses to write for invalid specs.
 */
export function runWatch(dirArg: string | undefined, options: WatchCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const startDir = path.resolve(cwd, dirArg ?? ".");

  const workspace = loadWorkspace(startDir);
  const featuresDir =
    workspace.configPath !== undefined
      ? path.resolve(workspace.root, workspace.config.features.directory)
      : startDir;

  const renderAll = () => {
    io.out(`${color.dim(timestamp())} validating ${path.relative(cwd, featuresDir) || "."} …`);
    runRender([featuresDir], { cwd, io });
  };

  const renderChanged = (file: string) => {
    io.out(`${color.dim(timestamp())} ${path.relative(cwd, file)} changed`);
    // Reload the workspace so subflow dependents of the changed feature are
    // re-validated too (their contracts may have changed).
    const current = loadWorkspace(startDir);
    const dependents = featureDependents(current).get(path.resolve(file)) ?? new Set<string>();
    const targets = [file, ...[...dependents].sort()];
    if (dependents.size > 0) {
      io.out(
        `${color.dim(timestamp())} also re-rendering ${dependents.size} dependent feature${dependents.size === 1 ? "" : "s"}`,
      );
    }
    runRender(targets, { cwd, io });
  };

  io.out(`Watching ${path.relative(cwd, featuresDir) || "."} for changes. Ctrl+C to stop.`);
  renderAll();

  watchWorkspace(
    watchTargetsFor(workspace, startDir),
    (_event, file) => {
      if (file.endsWith(FEATURE_FILE_SUFFIX)) {
        renderChanged(file);
      } else if (file.endsWith(".yaml") || file.endsWith(".yml")) {
        // Config or catalog changed: everything may be affected.
        renderAll();
      }
    },
    (error) => io.err(`Watcher error: ${error.message}`),
  );

  // chokidar keeps the process alive until the user interrupts.
  return EXIT_OK;
}
```

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/workspace/watch.ts src/cli/watch.ts tests/workspace/watch.test.ts
git commit -m "refactor: extract shared workspace-watch helper from the watch command"
```

---

### Task 2: Feature records (load + validate every feature)

**Files:**
- Create: `src/server/data.ts`
- Test: `tests/server/data.test.ts`

**Interfaces:**
- Consumes: `Workspace`, `WorkspaceFeatureRef`, `featureStem` from `../workspace/loader.js`; `FileTarget`, `validateTarget` from `../cli/shared.js`; `ValidationResult` from `../validator/validate.js`.
- Produces: `FeatureRecord { id: string; name: string; ref: WorkspaceFeatureRef; target: FileTarget; source: string; result: ValidationResult }`, `loadFeatureRecords(workspace: Workspace, cwd: string): FeatureRecord[]`, `findFeatureRecord(records: readonly FeatureRecord[], id: string): FeatureRecord | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/data.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadWorkspace } from "../../src/workspace/loader.js";
import { findFeatureRecord, loadFeatureRecords } from "../../src/server/data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("loadFeatureRecords", () => {
  it("loads and validates every feature in the booking workspace", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);

    expect(records.map((r) => r.id).sort()).toEqual(["booking", "notify-booking"]);
    const booking = findFeatureRecord(records, "booking");
    expect(booking?.name).toBe("Booking");
    expect(booking?.result.valid).toBe(true);
    expect(booking?.source).toContain("feature:");
    expect(booking?.result.stats?.steps).toBeGreaterThan(0);
  });

  it("findFeatureRecord returns undefined for an unknown id", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    expect(findFeatureRecord(records, "does-not-exist")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/data.test.ts`
Expected: FAIL — `src/server/data.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/data.ts
import fs from "node:fs";
import path from "node:path";
import { type FileTarget, validateTarget } from "../cli/shared.js";
import type { ValidationResult } from "../validator/validate.js";
import { featureStem, type Workspace, type WorkspaceFeatureRef } from "../workspace/loader.js";

/** One feature file plus its validated model, ready for dashboard rendering. */
export interface FeatureRecord {
  id: string;
  name: string;
  ref: WorkspaceFeatureRef;
  target: FileTarget;
  source: string;
  result: ValidationResult;
}

/**
 * Loads and validates every feature in the workspace. Re-reads and
 * re-validates from disk on every call — the dashboard always reflects the
 * current file state, the same "correctness over latency" stance as the
 * MCP server (docs/integrations.md).
 */
export function loadFeatureRecords(workspace: Workspace, cwd: string): FeatureRecord[] {
  const workspaceFor = () => workspace;
  return workspace.features.map((ref) => {
    const target: FileTarget = {
      path: ref.path,
      display: path.relative(cwd, ref.path) || ref.path,
    };
    const { result } = validateTarget(target, workspaceFor);
    let source = "";
    try {
      source = fs.readFileSync(ref.path, "utf8");
    } catch {
      source = "";
    }
    return {
      id: ref.id ?? featureStem(ref.path),
      name: ref.name ?? ref.id ?? featureStem(ref.path),
      ref,
      target,
      source,
      result,
    };
  });
}

export function findFeatureRecord(
  records: readonly FeatureRecord[],
  id: string,
): FeatureRecord | undefined {
  return records.find((record) => record.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/data.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/data.ts tests/server/data.test.ts
git commit -m "feat: load and validate every workspace feature for the dashboard"
```

---

### Task 3: Related-features computation

**Files:**
- Create: `src/server/related.ts`
- Test: `tests/server/related.test.ts`

**Interfaces:**
- Consumes: `FeatureRecord` from `./data.js` (Task 2).
- Produces: `RelatedFeatureRef { id: string; name: string; known: boolean }`, `RelatedEvent { event: string; direction: "publish" | "wait"; feature: RelatedFeatureRef }`, `RelatedFeatures { subflows: RelatedFeatureRef[]; dependents: RelatedFeatureRef[]; events: RelatedEvent[] }`, `computeRelated(record: FeatureRecord, records: readonly FeatureRecord[], dependents: ReadonlyMap<string, ReadonlySet<string>>): RelatedFeatures`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/related.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatureRecords } from "../../src/server/data.js";
import { computeRelated } from "../../src/server/related.js";
import { featureDependents, loadWorkspace } from "../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("computeRelated", () => {
  it("links booking and notify-booking through the BookingCreated event", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const dependents = featureDependents(workspace);

    const booking = records.find((r) => r.id === "booking");
    if (booking === undefined) throw new Error("booking record missing");
    const related = computeRelated(booking, records, dependents);

    expect(related.events).toContainEqual({
      event: "BookingCreated",
      direction: "wait",
      feature: { id: "notify-booking", name: "Booking Notification", known: true },
    });
  });

  it("marks a subflow target with no matching feature as unknown", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const dependents = featureDependents(workspace);
    const booking = records.find((r) => r.id === "booking");
    if (booking === undefined) throw new Error("booking record missing");

    const fabricated = { ...booking, ref: { ...booking.ref, flows: ["nonexistent-flow"] } };
    const related = computeRelated(fabricated, records, dependents);

    expect(related.subflows).toEqual([{ id: "nonexistent-flow", name: "nonexistent-flow", known: false }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/related.test.ts`
Expected: FAIL — `src/server/related.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/related.ts
import type { FeatureRecord } from "./data.js";

export interface RelatedFeatureRef {
  id: string;
  name: string;
  /** False when the reference does not resolve to a feature in this workspace. */
  known: boolean;
}

export interface RelatedEvent {
  event: string;
  /** "wait" = the other feature waits for an event this one publishes; "publish" = the reverse. */
  direction: "publish" | "wait";
  feature: RelatedFeatureRef;
}

export interface RelatedFeatures {
  subflows: RelatedFeatureRef[];
  dependents: RelatedFeatureRef[];
  events: RelatedEvent[];
}

function toRef(record: FeatureRecord): RelatedFeatureRef {
  return { id: record.id, name: record.name, known: true };
}

/**
 * Cross-feature relationships for one record: subflow targets it calls,
 * features that call it as a subflow, and features connected through a
 * shared event (one publishes what the other waits for).
 */
export function computeRelated(
  record: FeatureRecord,
  records: readonly FeatureRecord[],
  dependents: ReadonlyMap<string, ReadonlySet<string>>,
): RelatedFeatures {
  const byId = new Map(records.map((r) => [r.id, r]));
  const byPath = new Map(records.map((r) => [r.ref.path, r]));

  const subflows: RelatedFeatureRef[] = [...new Set(record.ref.flows)].map((flow) => {
    const target = byId.get(flow);
    return target !== undefined ? toRef(target) : { id: flow, name: flow, known: false };
  });

  const dependentPaths = dependents.get(record.ref.path) ?? new Set<string>();
  const dependentRefs: RelatedFeatureRef[] = [...dependentPaths]
    .map((p) => byPath.get(p))
    .filter((r): r is FeatureRecord => r !== undefined)
    .map(toRef);

  const events: RelatedEvent[] = [];
  for (const other of records) {
    if (other.id === record.id) continue;
    for (const name of record.ref.publishes) {
      if (other.ref.waitsFor.includes(name)) {
        events.push({ event: name, direction: "wait", feature: toRef(other) });
      }
    }
    for (const name of record.ref.waitsFor) {
      if (other.ref.publishes.includes(name)) {
        events.push({ event: name, direction: "publish", feature: toRef(other) });
      }
    }
  }
  events.sort((a, b) => a.event.localeCompare(b.event) || a.feature.id.localeCompare(b.feature.id));

  return { subflows, dependents: dependentRefs, events };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/related.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/related.ts tests/server/related.test.ts
git commit -m "feat: compute cross-feature relationships for the dashboard"
```

---

### Task 4: Shared HTML helpers (escaping + page chrome)

**Files:**
- Create: `src/server/html.ts`
- Test: `tests/server/html.test.ts`

**Interfaces:**
- Produces: `escapeHtml(text: string): string`, `badge(valid: boolean, errorCount: number, warningCount: number): string`, `layout(options: { title: string; body: string; head?: string; script?: string }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/html.test.ts
import { describe, expect, it } from "vitest";
import { badge, escapeHtml, layout } from "../../src/server/html.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)> & "quoted" 'single'`)).toBe(
      "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &#39;single&#39;",
    );
  });
});

describe("badge", () => {
  it("shows an error count when invalid", () => {
    expect(badge(false, 2, 0)).toContain("2 errors");
  });
  it("shows a warning count when valid with warnings", () => {
    expect(badge(true, 0, 1)).toContain("1 warning");
  });
  it("shows valid with no diagnostics", () => {
    expect(badge(true, 0, 0)).toContain("valid");
  });
});

describe("layout", () => {
  it("escapes the title, embeds the body and script verbatim, and wires live reload", () => {
    const html = layout({ title: "<x>", body: "<p>hi</p>", script: "console.log(1)" });
    expect(html).toContain("<title>&lt;x&gt;</title>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("console.log(1)");
    expect(html).toContain("EventSource");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/html.test.ts`
Expected: FAIL — `src/server/html.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/html.ts

/** Escapes text for safe interpolation into HTML content and attributes. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Validation summary badge for a dashboard card or a detail page header. */
export function badge(valid: boolean, errorCount: number, warningCount: number): string {
  if (!valid) {
    return `<span class="badge badge-error">${errorCount} error${errorCount === 1 ? "" : "s"}</span>`;
  }
  if (warningCount > 0) {
    return `<span class="badge badge-warn">${warningCount} warning${warningCount === 1 ? "" : "s"}</span>`;
  }
  return '<span class="badge badge-ok">valid</span>';
}

export interface LayoutOptions {
  title: string;
  body: string;
  /** Extra <head> content, e.g. a <script src> for a specific page. */
  head?: string;
  /** Extra inline <script> content, appended after the live-reload client. */
  script?: string;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 0; }
  header { padding: 12px 20px; border-bottom: 1px solid #8884; display: flex; gap: 16px; align-items: center; }
  header a { text-decoration: none; font-weight: 600; }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
  .badge-ok { background: #1a7f3722; color: #1a7f37; }
  .badge-warn { background: #9a670322; color: #9a6703; }
  .badge-error { background: #cf222e22; color: #cf222e; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
  .card a { text-decoration: none; font-size: 16px; font-weight: 600; }
  .muted { opacity: 0.65; font-size: 12px; }
  nav.tabs { display: flex; gap: 4px; border-bottom: 1px solid #8884; margin-bottom: 16px; }
  nav.tabs button { border: none; background: none; padding: 8px 14px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
  nav.tabs button.active { border-bottom-color: currentColor; font-weight: 600; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  pre { background: #8881; padding: 12px; border-radius: 6px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #8882; font-size: 13px; }
  tr.highlight { outline: 2px solid currentColor; }
  .diagnostic { border-left: 3px solid #8884; padding: 6px 10px; margin-bottom: 6px; }
  .diagnostic.error { border-left-color: #cf222e; }
  .diagnostic.warning { border-left-color: #9a6703; }
  #diagram-container .node { cursor: pointer; }
`;

const LIVE_RELOAD_SCRIPT = `
  try {
    var es = new EventSource("/events");
    es.onmessage = function () { location.reload(); };
  } catch (e) {}
`;

/** Shared page chrome: nav, styling, and the live-reload SSE client. */
export function layout(options: LayoutOptions): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${STYLE}</style>`,
    options.head ?? "",
    "</head>",
    "<body>",
    '<header><a href="/">LogicSpec Dashboard</a></header>',
    `<main>${options.body}</main>`,
    `<script>${LIVE_RELOAD_SCRIPT}</script>`,
    options.script !== undefined ? `<script>${options.script}</script>` : "",
    "</body>",
    "</html>",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/html.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/html.ts tests/server/html.test.ts
git commit -m "feat: add HTML escaping and shared page chrome for the dashboard"
```

---

### Task 5: Dashboard listing page

**Files:**
- Create: `src/server/pages/dashboard.ts`
- Test: `tests/server/pages/dashboard.test.ts`

**Interfaces:**
- Consumes: `FeatureRecord` (Task 2), `badge`/`escapeHtml`/`layout` (Task 4), `countBySeverity` from `../../diagnostics/diagnostic.js`.
- Produces: `renderDashboardPage(records: readonly FeatureRecord[]): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pages/dashboard.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatureRecords } from "../../../src/server/data.js";
import { renderDashboardPage } from "../../../src/server/pages/dashboard.js";
import { loadWorkspace } from "../../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("renderDashboardPage", () => {
  it("lists every feature as a linked, badged card", () => {
    const workspace = loadWorkspace(BOOKING);
    const records = loadFeatureRecords(workspace, BOOKING);
    const html = renderDashboardPage(records);

    expect(html).toContain('href="/features/booking"');
    expect(html).toContain('href="/features/notify-booking"');
    expect(html).toContain("Booking");
    expect(html).toContain("Booking Notification");
    expect(html).toContain("step");
  });

  it("renders a friendly message with no features", () => {
    expect(renderDashboardPage([])).toContain("No features found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/pages/dashboard.test.ts`
Expected: FAIL — `src/server/pages/dashboard.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/pages/dashboard.ts
import { countBySeverity } from "../../diagnostics/diagnostic.js";
import type { FeatureRecord } from "../data.js";
import { badge, escapeHtml, layout } from "../html.js";

function card(record: FeatureRecord): string {
  const counts = countBySeverity(record.result.diagnostics);
  const steps = record.result.stats?.steps ?? 0;
  return [
    '<div class="card">',
    `<a href="/features/${encodeURIComponent(record.id)}">${escapeHtml(record.name)}</a> `,
    badge(record.result.valid, counts.error, counts.warning),
    `<div class="muted">${escapeHtml(record.id)} · ${escapeHtml(record.target.display)} · ${steps} step${steps === 1 ? "" : "s"}</div>`,
    "</div>",
  ].join("\n");
}

/** `GET /` — every feature in the workspace, as a clickable card. */
export function renderDashboardPage(records: readonly FeatureRecord[]): string {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const body =
    sorted.length === 0 ? "<p>No features found in this workspace.</p>" : sorted.map(card).join("\n");
  return layout({ title: "LogicSpec Dashboard", body });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/pages/dashboard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/pages/dashboard.ts tests/server/pages/dashboard.test.ts
git commit -m "feat: render the dashboard listing page"
```

---

### Task 6: Feature detail page (diagram, steps, source, inspect, diagnostics, related)

**Files:**
- Create: `src/server/pages/feature-detail.ts`
- Test: `tests/server/pages/feature-detail.test.ts`

**Interfaces:**
- Consumes: `FeatureRecord` (Task 2), `RelatedFeatures` (Task 3), `badge`/`escapeHtml`/`layout` (Task 4), `renderMermaid` from `../../renderers/markdown.js`, `inspectFeature` from `../../inspect.js`, `countBySeverity` from `../../diagnostics/diagnostic.js`, `RenderView` from `../../schema/config.js`.
- Produces: `renderFeatureDetailPage(record: FeatureRecord, related: RelatedFeatures): string`. (No click-through yet — Task 7 adds it.)

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/pages/feature-detail.test.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findFeatureRecord, loadFeatureRecords } from "../../../src/server/data.js";
import { renderFeatureDetailPage } from "../../../src/server/pages/feature-detail.js";
import { computeRelated } from "../../../src/server/related.js";
import { featureDependents, loadWorkspace } from "../../../src/workspace/loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BOOKING = path.join(ROOT, "examples", "booking");

function bookingRecord() {
  const workspace = loadWorkspace(BOOKING);
  const records = loadFeatureRecords(workspace, BOOKING);
  const booking = findFeatureRecord(records, "booking");
  if (booking === undefined) throw new Error("booking record missing");
  return { workspace, records, booking };
}

describe("renderFeatureDetailPage", () => {
  it("renders every tab for a valid feature", () => {
    const { workspace, records, booking } = bookingRecord();
    const related = computeRelated(booking, records, featureDependents(workspace));

    const html = renderFeatureDetailPage(booking, related);

    expect(html).toContain(`<title>LogicSpec: ${booking.name}`);
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-tab="diagnostics"');
    expect(html).toContain('data-tab="related"');
    expect(html).toContain("notify-booking");
    for (const step of booking.result.normalized?.steps ?? []) {
      expect(html).toContain(`id="step-${step.id}"`);
    }
  });

  it("shows an invalid-spec fallback instead of crashing when the feature is broken", () => {
    const { workspace, records, booking } = bookingRecord();
    const broken = {
      ...booking,
      result: { valid: false, diagnostics: booking.result.diagnostics },
    };
    const related = computeRelated(broken, records, featureDependents(workspace));
    const html = renderFeatureDetailPage(broken, related);
    expect(html).toContain("Spec is invalid");
    expect(html).not.toContain('class="mermaid"');
  });

  it("escapes YAML-derived content instead of injecting markup", () => {
    const { workspace, records, booking } = bookingRecord();
    const normalized = booking.result.normalized;
    if (normalized === undefined) throw new Error("expected a normalized model");
    const tampered = {
      ...booking,
      result: {
        ...booking.result,
        normalized: {
          ...normalized,
          steps: normalized.steps.map((s, i) =>
            i === 0 ? { ...s, label: "<img src=x onerror=alert(1)>" } : s,
          ),
        },
      },
    };
    const related = computeRelated(tampered, records, featureDependents(workspace));
    const html = renderFeatureDetailPage(tampered, related);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/pages/feature-detail.test.ts`
Expected: FAIL — `src/server/pages/feature-detail.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/pages/feature-detail.ts
import { countBySeverity } from "../../diagnostics/diagnostic.js";
import { inspectFeature } from "../../inspect.js";
import { renderMermaid } from "../../renderers/markdown.js";
import type { RenderView } from "../../schema/config.js";
import type { FeatureRecord } from "../data.js";
import { badge, escapeHtml, layout } from "../html.js";
import type { RelatedFeatureRef, RelatedFeatures } from "../related.js";

const DIAGRAM_VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];

function diagramTab(record: FeatureRecord): string {
  const { normalized, graph } = record.result;
  if (!record.result.valid || normalized === undefined || graph === undefined) {
    return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  }
  const blocks = DIAGRAM_VIEWS.map((view) => {
    let mermaid: string;
    try {
      mermaid = renderMermaid(normalized, graph, { view });
    } catch {
      return "";
    }
    const hidden = view === "flow" ? "" : " hidden";
    return `<div data-diagram-view="${view}"${hidden}><pre class="mermaid">${escapeHtml(mermaid)}</pre></div>`;
  }).join("\n");
  const options = DIAGRAM_VIEWS.map((v) => `<option value="${v}">${v}</option>`).join("");
  return [
    `<label>View <select id="diagram-view-select">${options}</select></label>`,
    '<div id="diagram-container">',
    blocks,
    "</div>",
  ].join("\n");
}

function stepsTab(record: FeatureRecord): string {
  const normalized = record.result.normalized;
  if (normalized === undefined) return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  const rows = normalized.steps
    .map(
      (step) =>
        `<tr id="step-${escapeHtml(step.id)}"><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.type)}</td><td>${escapeHtml(step.label)}</td><td>${escapeHtml(step.actor ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<table><thead><tr><th>id</th><th>type</th><th>label</th><th>actor</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sourceTab(record: FeatureRecord): string {
  return `<pre>${escapeHtml(record.source)}</pre>`;
}

function inspectTab(record: FeatureRecord): string {
  const { normalized, graph } = record.result;
  if (normalized === undefined || graph === undefined) {
    return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  }
  const report = inspectFeature(normalized, graph);
  return `<pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>`;
}

function diagnosticsTab(record: FeatureRecord): string {
  if (record.result.diagnostics.length === 0) return "<p>No findings.</p>";
  return record.result.diagnostics
    .map((d) => {
      const position = d.location !== undefined ? `:${d.location.line}:${d.location.column}` : "";
      return [
        `<div class="diagnostic ${escapeHtml(d.severity)}">`,
        `<strong>${escapeHtml(d.code)}</strong> ${escapeHtml(d.severity)} — ${escapeHtml(d.message)}`,
        `<div class="muted">${escapeHtml(record.target.display)}${position}</div>`,
        "</div>",
      ].join("");
    })
    .join("\n");
}

function refList(refs: readonly RelatedFeatureRef[]): string {
  if (refs.length === 0) return '<p class="muted">None.</p>';
  return `<ul>${refs
    .map((r) =>
      r.known
        ? `<li><a href="/features/${encodeURIComponent(r.id)}">${escapeHtml(r.name)}</a></li>`
        : `<li>${escapeHtml(r.name)} <span class="muted">(not found in this workspace)</span></li>`,
    )
    .join("\n")}</ul>`;
}

function relatedTab(related: RelatedFeatures): string {
  const eventsList =
    related.events.length === 0
      ? '<p class="muted">None.</p>'
      : `<ul>${related.events
          .map(
            (e) =>
              `<li><strong>${escapeHtml(e.event)}</strong> — <a href="/features/${encodeURIComponent(e.feature.id)}">${escapeHtml(e.feature.name)}</a> ${e.direction === "wait" ? "waits for it" : "publishes it"}</li>`,
          )
          .join("\n")}</ul>`;
  return [
    "<h3>Subflows called</h3>",
    refList(related.subflows),
    "<h3>Dependents (call this as a subflow)</h3>",
    refList(related.dependents),
    "<h3>Shared events</h3>",
    eventsList,
  ].join("\n");
}

const TABS = ["diagram", "steps", "source", "inspect", "diagnostics", "related"] as const;
type Tab = (typeof TABS)[number];

const TAB_SCRIPT = `
  var buttons = document.querySelectorAll("nav.tabs button");
  var panels = document.querySelectorAll(".tab-panel");
  function activateTab(tab) {
    buttons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    panels.forEach(function (p) { p.classList.toggle("active", p.dataset.tab === tab); });
  }
  buttons.forEach(function (b) { b.addEventListener("click", function () { activateTab(b.dataset.tab); }); });
  activateTab("diagram");
  var viewSelect = document.getElementById("diagram-view-select");
  if (viewSelect) {
    viewSelect.addEventListener("change", function () {
      document.querySelectorAll("[data-diagram-view]").forEach(function (el) {
        el.hidden = el.dataset.diagramView !== viewSelect.value;
      });
    });
  }
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    mermaid.run();
  }
`;

/** `GET /features/:id` — full detail: diagram, steps, source, inspect, diagnostics, related. */
export function renderFeatureDetailPage(record: FeatureRecord, related: RelatedFeatures): string {
  const counts = countBySeverity(record.result.diagnostics);
  const tabButtons = TABS.map(
    (tab, i) => `<button data-tab="${tab}"${i === 0 ? ' class="active"' : ""}>${tab}</button>`,
  ).join("\n");
  const panels: Record<Tab, string> = {
    diagram: diagramTab(record),
    steps: stepsTab(record),
    source: sourceTab(record),
    inspect: inspectTab(record),
    diagnostics: diagnosticsTab(record),
    related: relatedTab(related),
  };
  const body = [
    '<p><a href="/">&larr; Dashboard</a></p>',
    `<h1>${escapeHtml(record.name)} ${badge(record.result.valid, counts.error, counts.warning)}</h1>`,
    `<p class="muted">${escapeHtml(record.id)} · ${escapeHtml(record.target.display)}</p>`,
    `<nav class="tabs">${tabButtons}</nav>`,
    ...TABS.map(
      (tab, i) => `<div class="tab-panel${i === 0 ? " active" : ""}" data-tab="${tab}">${panels[tab]}</div>`,
    ),
  ].join("\n");
  return layout({
    title: `LogicSpec: ${record.name}`,
    body,
    head: '<script src="/assets/mermaid.min.js"></script>',
    script: TAB_SCRIPT,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/pages/feature-detail.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/pages/feature-detail.ts tests/server/pages/feature-detail.test.ts
git commit -m "feat: render the full feature detail page"
```

---

### Task 7: Diagram node click-through

**Files:**
- Create: `src/server/click-map.ts`
- Modify: `src/server/pages/feature-detail.ts`
- Test: `tests/server/click-map.test.ts`

**Interfaces:**
- Consumes: `mermaidNodeIdMap` from `../renderers/mermaid-common.js`, `NormalizedFeature` from `../graph/normalize.js`, `FeatureGraph` from `../graph/edges.js`.
- Produces: `ClickTarget { stepId: string; flow?: string }`, `buildNodeClickMap(normalized: NormalizedFeature, graph: FeatureGraph): Record<string, ClickTarget>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/click-map.test.ts
import { describe, expect, it } from "vitest";
import { buildNodeClickMap } from "../../src/server/click-map.js";
import { buildGraph } from "../../src/graph/edges.js";
import { normalizeFeature } from "../../src/graph/normalize.js";
import type { FeatureFile } from "../../src/schema/feature.js";

const feature: FeatureFile = {
  version: "1",
  feature: { id: "test", name: "Test" },
  start: "s1",
  steps: {
    s1: { type: "subflow", flow: "other-feature", next: "s2" },
    s2: { type: "final", outcome: "done" },
  },
};

describe("buildNodeClickMap", () => {
  it("maps a subflow step's node to its target feature id", () => {
    const normalized = normalizeFeature(feature);
    const graph = buildGraph(normalized);
    const map = buildNodeClickMap(normalized, graph);

    const entries = Object.values(map);
    const subflowEntry = entries.find((e) => e.stepId === "s1");
    const finalEntry = entries.find((e) => e.stepId === "s2");

    expect(subflowEntry).toEqual({ stepId: "s1", flow: "other-feature" });
    expect(finalEntry).toEqual({ stepId: "s2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/click-map.test.ts`
Expected: FAIL — `src/server/click-map.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/click-map.ts
import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import { mermaidNodeIdMap } from "../renderers/mermaid-common.js";

export interface ClickTarget {
  stepId: string;
  /** Present only when the step is a subflow call — its target feature id. */
  flow?: string;
}

/**
 * Mermaid node id → click target for one feature's diagram. Reuses
 * `mermaidNodeIdMap` (the same id-allocation the VS Code webview uses) so
 * the dashboard's delegated click listener needs no Mermaid `click`
 * directives — those require `securityLevel: "loose"`, already rejected in
 * docs/superpowers/specs/2026-08-10-vscode-clickable-preview-design.md.
 */
export function buildNodeClickMap(
  normalized: NormalizedFeature,
  graph: FeatureGraph,
): Record<string, ClickTarget> {
  const idMap = mermaidNodeIdMap(graph);
  const byStepId = new Map(normalized.steps.map((s) => [s.id, s]));
  const map: Record<string, ClickTarget> = {};
  for (const [mermaidId, stepId] of idMap) {
    const step = byStepId.get(stepId);
    let flow: string | undefined;
    if (step !== undefined && step.def.type === "subflow") flow = step.def.flow;
    map[mermaidId] = flow !== undefined ? { stepId, flow } : { stepId };
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/click-map.test.ts`
Expected: PASS

- [ ] **Step 5: Wire click-through into the detail page**

In `src/server/pages/feature-detail.ts`:

Add the import:

```ts
import { buildNodeClickMap } from "../click-map.js";
```

Replace the `diagramTab` function with a version that also emits the click-map JSON:

```ts
function diagramTab(record: FeatureRecord): string {
  const { normalized, graph } = record.result;
  if (!record.result.valid || normalized === undefined || graph === undefined) {
    return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  }
  const blocks = DIAGRAM_VIEWS.map((view) => {
    let mermaid: string;
    try {
      mermaid = renderMermaid(normalized, graph, { view });
    } catch {
      return "";
    }
    const hidden = view === "flow" ? "" : " hidden";
    return `<div data-diagram-view="${view}"${hidden}><pre class="mermaid">${escapeHtml(mermaid)}</pre></div>`;
  }).join("\n");
  const options = DIAGRAM_VIEWS.map((v) => `<option value="${v}">${v}</option>`).join("");
  const clickMap = JSON.stringify(buildNodeClickMap(normalized, graph));
  return [
    `<label>View <select id="diagram-view-select">${options}</select></label>`,
    '<div id="diagram-container">',
    blocks,
    "</div>",
    `<script type="application/json" id="node-click-map">${clickMap}</script>`,
  ].join("\n");
}
```

Extend `TAB_SCRIPT` with the delegated click listener (append after the existing `mermaid.run();` line, still inside the same template string):

```ts
const TAB_SCRIPT = `
  var buttons = document.querySelectorAll("nav.tabs button");
  var panels = document.querySelectorAll(".tab-panel");
  function activateTab(tab) {
    buttons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    panels.forEach(function (p) { p.classList.toggle("active", p.dataset.tab === tab); });
  }
  buttons.forEach(function (b) { b.addEventListener("click", function () { activateTab(b.dataset.tab); }); });
  activateTab("diagram");
  var viewSelect = document.getElementById("diagram-view-select");
  if (viewSelect) {
    viewSelect.addEventListener("change", function () {
      document.querySelectorAll("[data-diagram-view]").forEach(function (el) {
        el.hidden = el.dataset.diagramView !== viewSelect.value;
      });
    });
  }
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    mermaid.run();
  }
  var clickMapEl = document.getElementById("node-click-map");
  var nodeClickMap = clickMapEl ? JSON.parse(clickMapEl.textContent || "{}") : {};
  var diagramContainer = document.getElementById("diagram-container");
  if (diagramContainer) {
    diagramContainer.addEventListener("click", function (event) {
      var nodeEl = event.target.closest ? event.target.closest("g.node[id]") : null;
      if (!nodeEl) return;
      var match = /^flowchart-(.+)-\\d+$/.exec(nodeEl.id);
      if (!match) return;
      var target = nodeClickMap[match[1]];
      if (!target) return;
      if (target.flow) {
        location.href = "/features/" + encodeURIComponent(target.flow);
        return;
      }
      var stepsButton = document.querySelector('nav.tabs button[data-tab="steps"]');
      if (stepsButton) activateTab("steps");
      var row = document.getElementById("step-" + target.stepId);
      if (row) {
        row.scrollIntoView({ block: "center" });
        row.classList.add("highlight");
        setTimeout(function () { row.classList.remove("highlight"); }, 1500);
      }
    });
  }
`;
```

- [ ] **Step 6: Update the existing detail-page test to cover the click map**

Add to `tests/server/pages/feature-detail.test.ts`, inside the `describe("renderFeatureDetailPage", ...)` block:

```ts
  it("embeds a node-click map for diagram navigation", () => {
    const { workspace, records, booking } = bookingRecord();
    const related = computeRelated(booking, records, featureDependents(workspace));
    const html = renderFeatureDetailPage(booking, related);
    expect(html).toContain('id="node-click-map"');
    expect(html).toContain("nodeClickMap");
  });
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/server/click-map.test.ts tests/server/pages/feature-detail.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/server/click-map.ts src/server/pages/feature-detail.ts tests/server/click-map.test.ts tests/server/pages/feature-detail.test.ts
git commit -m "feat: make diagram nodes clickable (subflow jump, step highlight)"
```

---

### Task 8: Mermaid asset resolution

**Files:**
- Create: `src/server/assets.ts`
- Modify: `package.json` (add `mermaid` dependency)
- Test: `tests/server/assets.test.ts`

**Interfaces:**
- Produces: `defaultMermaidAssetPath(): string`.

- [ ] **Step 1: Add `mermaid` as a root dependency**

In `package.json`, add to `"dependencies"` (keep alphabetical order with the existing entries):

```json
"dependencies": {
  "chokidar": "^4.0.3",
  "commander": "^14.0.0",
  "mermaid": "^11.0.0",
  "yaml": "^2.8.0",
  "zod": "^4.0.0"
}
```

Run: `npm install`
Expected: `mermaid` and its transitive deps appear under `node_modules/`, `package-lock.json` updates.

- [ ] **Step 2: Write the failing test**

```ts
// tests/server/assets.test.ts
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultMermaidAssetPath } from "../../src/server/assets.js";

describe("defaultMermaidAssetPath", () => {
  it("resolves to an existing file named mermaid.min.js", () => {
    const assetPath = defaultMermaidAssetPath();
    expect(assetPath.endsWith("mermaid.min.js")).toBe(true);
    expect(fs.existsSync(assetPath)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/server/assets.test.ts`
Expected: FAIL — `src/server/assets.js` does not exist.

- [ ] **Step 4: Write the implementation**

```ts
// src/server/assets.ts
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Locates the `mermaid` package's prebuilt browser bundle from wherever
 * this module's dependencies resolve — the CLI's own `node_modules`, where
 * `mermaid` is a real dependency of this package. VS Code passes its own
 * `mermaidAssetPath` override instead (see src/server/create-server.ts):
 * the packaged extension excludes `node_modules`, so this resolution would
 * fail there.
 */
export function defaultMermaidAssetPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("mermaid/package.json");
  return path.join(path.dirname(packageJsonPath), "dist", "mermaid.min.js");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/assets.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/assets.ts tests/server/assets.test.ts package.json package-lock.json
git commit -m "feat: add mermaid dependency and resolve its browser bundle"
```

---

### Task 9: HTTP server (routing, no live reload yet)

**Files:**
- Create: `src/server/create-server.ts`
- Modify: `src/index.ts` (export `createDashboardServer`)
- Test: `tests/server/create-server.test.ts`

**Interfaces:**
- Consumes: `loadWorkspace`, `featureDependents` from `../workspace/loader.js`; `loadFeatureRecords`, `findFeatureRecord` (Task 2); `computeRelated` (Task 3); `renderDashboardPage` (Task 5); `renderFeatureDetailPage` (Task 6/7); `defaultMermaidAssetPath` (Task 8); `escapeHtml`, `layout` (Task 4).
- Produces: `DashboardServerOptions { mermaidAssetPath?: string }`, `createDashboardServer(workspaceDir: string, options?: DashboardServerOptions): http.Server` — returns an unstarted server; callers own `.listen()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/create-server.test.ts
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

describe("createDashboardServer", () => {
  it("serves the dashboard listing every feature", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Booking");
    expect(html).toContain('href="/features/booking"');
  });

  it("serves a feature detail page", async () => {
    const res = await fetch(`${base}/features/booking`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('class="mermaid"');
  });

  it("404s for an unknown feature id", async () => {
    const res = await fetch(`${base}/features/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("serves the mermaid asset", async () => {
    const res = await fetch(`${base}/assets/mermaid.min.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/create-server.test.ts`
Expected: FAIL — `src/server/create-server.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/create-server.ts
import fs from "node:fs";
import http from "node:http";
import { featureDependents, loadWorkspace } from "../workspace/loader.js";
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

  return http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method not allowed");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

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

    notFound(res);
  });
}
```

- [ ] **Step 4: Export from the public API**

In `src/index.ts`, after the `// MCP server (Node-only)` export block, add:

```ts
// Dashboard server (Node-only)
export {
  createDashboardServer,
  type DashboardServerOptions,
} from "./server/create-server.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/server/create-server.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/create-server.ts src/index.ts tests/server/create-server.test.ts
git commit -m "feat: add the dashboard HTTP server (dashboard, detail, mermaid asset routes)"
```

---

### Task 10: Live reload (SSE)

**Files:**
- Modify: `src/server/create-server.ts`
- Test: `tests/server/live-reload.test.ts`

**Interfaces:**
- Consumes: `watchTargetsFor`, `watchWorkspace` (Task 1).
- Produces: `GET /events` (SSE) on the server created by `createDashboardServer`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/live-reload.test.ts
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("live reload", () => {
  it(
    "pushes a reload event when a feature file changes",
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-serve-"));
      fs.cpSync(BOOKING, tmp, { recursive: true });
      const server = createDashboardServer(tmp);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;

      try {
        const controller = new AbortController();
        const res = await fetch(`http://127.0.0.1:${address.port}/events`, {
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        if (reader === undefined) throw new Error("expected a streaming response body");

        const received = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("timed out waiting for SSE reload")),
            4000,
          );
          const decoder = new TextDecoder();
          let buffer = "";
          const pump = (): void => {
            reader
              .read()
              .then(({ value, done }) => {
                if (done) return;
                buffer += decoder.decode(value);
                if (buffer.includes("data: reload")) {
                  clearTimeout(timeout);
                  resolve(buffer);
                  return;
                }
                pump();
              })
              .catch(reject);
          };
          pump();
        });

        // Give the watcher a moment to finish its initial scan before touching the file.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const featureFile = path.join(tmp, "booking.feature.yaml");
        fs.writeFileSync(featureFile, `${fs.readFileSync(featureFile, "utf8")}\n`);

        await expect(received).resolves.toContain("data: reload");
        controller.abort();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    8000,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/live-reload.test.ts`
Expected: FAIL — `/events` currently 404s (falls through to `notFound`).

- [ ] **Step 3: Add the SSE route and file watcher**

In `src/server/create-server.ts`, add the import:

```ts
import { watchTargetsFor, watchWorkspace } from "../workspace/watch.js";
```

Replace the body of `createDashboardServer` with:

```ts
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

    notFound(res);
  });

  server.on("close", () => {
    for (const client of sseClients) client.end();
    watcher?.close();
  });

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/live-reload.test.ts tests/server/create-server.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/create-server.ts tests/server/live-reload.test.ts
git commit -m "feat: live-reload the dashboard on workspace file changes (SSE)"
```

---

### Task 11: CLI command — `logicspec serve`

**Files:**
- Create: `src/cli/serve.ts`
- Modify: `src/cli/main.ts`
- Test: `tests/cli/serve.test.ts`

**Interfaces:**
- Consumes: `createDashboardServer` (Task 9/10), `requireWorkspace` from `./shared.js`, `color`/`Io`/`printDiagnostics`/`processIo` from `./report.js`.
- Produces: `runServe(dirArg: string | undefined, options?: ServeCommandOptions): number`, CLI command `serve [dir] [--port] [--host] [--open]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/serve.test.ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runServe } from "../../src/cli/serve.js";
import type { Io } from "../../src/cli/report.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function captureIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

describe("serve command", () => {
  it("starts the dashboard for the booking workspace", async () => {
    const io = captureIo();
    const started = new Promise<Server>((resolve) => {
      const code = runServe(path.join(ROOT, "examples", "booking"), {
        cwd: ROOT,
        io,
        port: 0,
        onListening: resolve,
      });
      expect(code).toBe(0);
    });
    const server = await started;
    try {
      const address = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(res.status).toBe(200);
      expect(io.stdout.join("\n")).toContain("dashboard running");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exits 2 without a workspace config", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-serve-nows-"));
    try {
      const io = captureIo();
      expect(runServe(empty, { cwd: empty, io })).toBe(2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/serve.test.ts`
Expected: FAIL — `src/cli/serve.js` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// src/cli/serve.ts
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
```

- [ ] **Step 4: Register the command in `src/cli/main.ts`**

Add the import:

```ts
import { runServe } from "./serve.js";
```

Add the command (after the `watch` command, before `export`):

```ts
program
  .command("serve")
  .description(`run a local read-only dashboard over the workspace (default: http://127.0.0.1:${27000})`)
  .argument("[dir]", "workspace directory (default: current)")
  .option("--port <port>", "port to listen on (default: 27000)", (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new CommanderError(EXIT_USAGE, "logicspec.invalidOption", `Invalid port "${value}".`);
    }
    return parsed;
  })
  .option("--host <host>", "host to bind (default: 127.0.0.1)")
  .option("--open", "open the dashboard in your default browser")
  .action((dir: string | undefined, options: { port?: number; host?: string; open?: boolean }) => {
    process.exitCode = runServe(dir, options);
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/cli/serve.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Manually verify the real CLI**

Run: `npm run build && node dist/cli/main.js serve examples/booking --port 27000`

Open `http://127.0.0.1:27000` in a browser; click into a feature; confirm the diagram, tabs, and Related section render. Stop with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add src/cli/serve.ts src/cli/main.ts tests/cli/serve.test.ts
git commit -m "feat: add the logicspec serve CLI command"
```

---

### Task 12: VS Code command — "LogicSpec: Start Dashboard"

**Files:**
- Create: `integrations/vscode/src/dashboard.ts`
- Modify: `integrations/vscode/src/extension.ts`, `integrations/vscode/package.json`
- Test: `integrations/vscode/tests/bundle-load.test.ts` (extend)

**Interfaces:**
- Consumes: `createDashboardServer` from `"logicspec"` (aliased to `../../src/index.ts`), `graphStartDir` from `./graph-preview.js`.
- Produces: `startDashboard(context: vscode.ExtensionContext, startDir: string): void`, `disposeDashboard(): void`, command `logicspec.startDashboard`.

- [ ] **Step 1: Write the implementation**

```ts
// integrations/vscode/src/dashboard.ts
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

function listenAndOpen(server: ReturnType<typeof createDashboardServer>, port: number, dir: string): void {
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

  const mermaidAssetPath = vscode.Uri.joinPath(context.extensionUri, "media", "mermaid.min.js").fsPath;
  const server = createDashboardServer(startDir, { mermaidAssetPath });
  listenAndOpen(server, DEFAULT_PORT, startDir);
}

export function disposeDashboard(): void {
  current?.server.close();
  current = undefined;
}
```

- [ ] **Step 2: Register the command in `extension.ts`**

Add the import:

```ts
import { disposeDashboard, startDashboard } from "./dashboard.js";
```

Add to the `context.subscriptions.push(...)` block that registers commands (alongside `logicspec.previewWorkspaceGraph`):

```ts
vscode.commands.registerCommand("logicspec.startDashboard", () => {
  const startDir = graphStartDir();
  if (startDir === undefined) {
    void vscode.window.showWarningMessage(
      "LogicSpec: open a folder or file inside a LogicSpec workspace first.",
    );
    return;
  }
  startDashboard(context, startDir);
}),
```

In `deactivate()`, add:

```ts
export function deactivate(): void {
  disposeDashboard();
  // Other disposables are handled via context.subscriptions.
}
```

- [ ] **Step 3: Add the command and menu entry to `package.json`**

In `"contributes"."commands"`, add:

```json
{
  "command": "logicspec.startDashboard",
  "title": "LogicSpec: Start Dashboard",
  "icon": "$(globe)"
}
```

In `"contributes"."menus"."editor/title"`, add (matching the existing `previewWorkspaceGraph` entry):

```json
{
  "command": "logicspec.startDashboard",
  "when": "resourceFilename == 'logicspec.config.yaml'",
  "group": "navigation"
}
```

- [ ] **Step 4: Extend the bundle-load test**

In `integrations/vscode/tests/bundle-load.test.ts`, add to `makeVscodeStub`'s returned object (alongside `window`):

```ts
env: {
  openExternal: async () => true,
},
```

Add to the assertions inside `it("loads and registers its commands under a stubbed vscode host", ...)`:

```ts
expect(registered).toContain("logicspec.startDashboard");
```

- [ ] **Step 5: Build and run the extension's test suite**

Run (from `integrations/vscode/`):

```bash
cd integrations/vscode
npm run typecheck
npm run build
npm test
```

Expected: PASS — the build copies `media/mermaid.min.js` (unchanged, already part of the existing build step) and `bundle-load.test.ts` confirms `logicspec.startDashboard` registers.

- [ ] **Step 6: Commit**

```bash
cd /home/sfard/Codes/Private/LogicSpec
git add integrations/vscode/src/dashboard.ts integrations/vscode/src/extension.ts integrations/vscode/package.json integrations/vscode/tests/bundle-load.test.ts
git commit -m "feat(vscode): add LogicSpec: Start Dashboard command"
```

---

### Task 13: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/integrations.md`

**Interfaces:** None (docs only).

- [ ] **Step 1: Update the CLI commands line in `CLAUDE.md` and `AGENTS.md`**

In both files, in the line starting `CLI commands: \`init\` · ...`, insert a new entry after `watch [dir] (re-renders subflow dependents)` and before `graph [dir] [--services]`:

```
· `serve [dir] [--port] [--host] [--open]` (local read-only dashboard, default http://127.0.0.1:27000)
```

The full sentence becomes (identical in both files):

```
CLI commands: `init` · `validate [paths...] [--strict] [--json]` (no paths = whole workspace) · `render <paths...> [--view flow|swimlane|sequence|event-model] [--format md|mermaid] [--direction TD|TB|LR|RL|BT] [--output]` · `export [dir]` (full artifact build into .logicspec/) · `inspect <paths...> [--json]` · `watch [dir]` (re-renders subflow dependents) · `serve [dir] [--port] [--host] [--open]` (local read-only dashboard, default http://127.0.0.1:27000) · `graph [dir] [--services]` · `diff <before> <after> [--json]` · `mcp [dir]`. Exit codes: 0 ok, 1 validation errors, 2 parse/config/usage errors (diff: 0 even when different).
```

- [ ] **Step 2: Add a `logicspec serve` section to `README.md`**

After the `### \`logicspec watch [dir]\`` section (before `### \`logicspec export [dir]\``), insert:

```markdown
### `logicspec serve [dir]`

Runs a local, read-only dashboard over the workspace: every feature listed and clickable, each with a full-detail page — diagram (with a view switcher and clickable subflow nodes), raw YAML source, the same stable model `inspect --json` returns, validation diagnostics, and cross-references (subflow calls, dependents, shared events). Defaults to `http://127.0.0.1:27000`; `--port`, `--host` and `--open` (launch your default browser) override the defaults. Live-reloads on every save.
```

Also add a line to the top usage block (~line 83, after the `logicspec watch` line):

```
logicspec serve                                 # browse the workspace at http://localhost:27000
```

- [ ] **Step 3: Add a "Dashboard server" section to `docs/integrations.md`**

After the `## MCP server` section (before `## VS Code extension`), insert:

```markdown
## Dashboard server

`logicspec serve [dir]` runs a local, read-only HTTP dashboard over a workspace at `http://127.0.0.1:27000` by default (`--port`, `--host`, `--open`). Every feature is listed and clickable; each detail page has a diagram (view switcher, clickable subflow nodes — reusing the same node-id-map click pattern as the VS Code preview, not Mermaid's `click` directive), raw source, the `inspect` model, diagnostics, and cross-feature links (subflow calls, dependents, shared events). Live-reloads on every save via Server-Sent Events. No editing — for that, use the visual editor below.
```

Add a bullet under the `## VS Code extension` section's feature list (after "LogicSpec: Validate Workspace"):

```markdown
* **LogicSpec: Start Dashboard** — launches the local dashboard server (above) and opens it in your default browser.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md AGENTS.md docs/integrations.md
git commit -m "docs: document the logicspec serve command and dashboard"
```

---

### Task 14: Full verification

**Files:** None (verification only).

- [ ] **Step 1: Full root test suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS, no regressions in existing suites.

- [ ] **Step 2: Booking example still validates**

Run: `npm run build && node dist/cli/main.js validate examples/booking`
Expected: exit code `0`.

- [ ] **Step 3: VS Code integration checks**

Run:

```bash
cd integrations/vscode
npm run typecheck && npm test
cd ../..
```

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run: `node dist/cli/main.js serve examples/booking --open`

Confirm in the browser: dashboard lists `booking` and `notify-booking`; each detail page's Diagram/Steps/Source/Inspect/Diagnostics/Related tabs all render; the Related tab's `BookingCreated` event link navigates between the two features; editing `examples/booking/booking.feature.yaml` (then reverting) triggers a live reload. Stop the server with Ctrl+C.

- [ ] **Step 5: Commit (only if any fixes were needed in prior steps)**

If Steps 1–4 required no code changes, skip this commit — there is nothing new to record.
