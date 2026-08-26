# Changelog

All notable changes to LogicSpec. The DSL itself is versioned independently
(`version: "1"` in documents); this file tracks the toolchain.

## Unreleased

Nothing yet.

## 0.14.0 — 2026-08-26

**Production hardening: server security, CLI correctness, lockstep versions,
documentation catch-up.** All packages (core, VS Code extension, visual
editor, Obsidian plugin, Claude Code plugin) now share one version, enforced
by `npm run check:versions` in CI.

Security & robustness:

- `serve` rejects requests with an unrecognized `Host` header (DNS-rebinding
  defense); loopback names are always accepted, `--host <name>` allowlists
  that name, and a wildcard bind (`0.0.0.0`/`::`) disables the check with a
  loud warning that the workspace source is exposed unauthenticated.
- A request with malformed percent-encoding (`/api/features/%`) no longer
  crashes the dashboard process; any handler bug now costs one 500 response,
  never the server.
- A taken port (`EADDRINUSE`) or unbindable `--host` reports a friendly
  error and exits 2 instead of an uncaught stack trace with exit 0.
- The config-driven `output.directory` is now containment-checked like every
  other config path (LS005): `export`/`render`/`graph` refuse to write
  outside the workspace root (an explicit `--output` remains the user's own
  choice).
- Static assets 404 when missing (previously 200 with the SPA shell) and are
  served through a realpath containment check that refuses symlink escapes.
- API responses carry `Cache-Control: no-store`; `/health` answers GET and
  HEAD; HEAD works on page routes; SIGINT/SIGTERM shut the server down
  cleanly; IPv6 hosts print bracketed, navigable URLs.
- Piped output (`validate | head`) keeps the earned exit code instead of
  exiting 0 on EPIPE; `inspect --json` prints diagnostics to stderr so
  stdout is pure JSON.

MCP:

- `validate_feature` now returns the same verdict as `logicspec validate`:
  severity overrides and flow-outcome contracts apply, and workspace-level
  catalog findings are included in a new `workspaceDiagnostics` field.
- The dashboard's MCP page derives its tool table from the MCP server's own
  definitions (no more hand-maintained copy), and quotes the workspace path
  in the copy-paste command.

Toolchain & CI:

- `npm run build` cleans `dist/` first, so stale build artifacts can never
  ship in the npm tarball again.
- New `npm run check:versions` (lockstep across all six manifests) and
  `npm run check:docs` (every LS code documented in docs/validation.md and
  the Claude plugin's diagnostics reference), both wired into CI.
- CI validates every example workspace, not just `examples/booking`.
- The suggestion-budget DoS-guard test no longer asserts wall-clock time
  (flaky under parallel suite load); the deterministic cap assertion stands.

Docs & examples:

- `docs/specification.md`, `docs/views.md`, README, roadmap and publishing
  docs caught up with the 0.6–0.13 language: typed events, decision tables,
  boundary handlers, agent zones, `final.terminate`, `$ref` shared
  definitions, `serve`/`export`, `--debug`.
- The Claude Code plugin's skill teaches the full current language and all
  diagnostic codes, and a second skill — `logicspec-implementing` — covers
  the consuming side: reading a spec as an implementation contract and
  deriving unit/integration/E2E tests from it (per-outcome matrices,
  boundary/timeout tests, data-flow assertions, journey scripting from
  pages' routes and action labels), plus a `/logicspec:tests` command.
- Every example directory is a validating workspace with a README; the
  `wait` step type is now exercised by an example.

## 0.13.0 — 2026-08-26

**Dashboard: interactive step detail, full-screen shell, live dark mode.**

- Clicking a step in the interactive canvas opens a side panel (description,
  notes, tags, requires/produces, incoming/outgoing transitions) instead of
  switching to the Steps tab. A subflow step's panel shows the linked
  feature's name/description with a link to open it, replacing the old
  instant-navigate.
- The feature-detail page is a single full-screen app shell: a slim top bar
  (back link, feature name/status, tab switcher, and the diagram view
  picker) with whichever tab is active filling the rest of the viewport —
  every tab, not just Diagram.
- The feature list is a compact table with a description column instead of
  stacked cards.
- Dark mode actually works now: the interactive canvas's controls/minimap
  and all four Mermaid views switch to their dark palettes and track live
  OS theme changes (previously stuck on their light-theme defaults).
- Server: feature-level `description` and per-step `description`/`notes`/
  `tags` are now included in the dashboard's JSON API (already computed,
  just never threaded through before).

## 0.12.0 — 2026-08-25

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
- `DashboardServerOptions` (exported from `src/index.ts`, used by
  `createDashboardServer`) changed shape: `mermaidAssetPath` was dropped and
  `publicDir` was added, for anyone embedding `createDashboardServer`
  programmatically.
- `mermaid` moves back out of `dependencies` (bundled by Vite at build time
  instead of resolved from `node_modules` at request time) — the published
  package's real runtime dependencies are unchanged: `chokidar`,
  `commander`, `yaml`, `zod`.

## 0.11.0 — 2026-08-24

**New: `logicspec serve` — a local, read-only dashboard.** No DSL or schema
changes; every existing spec is unaffected.

- **`logicspec serve [dir]`** runs a local HTTP dashboard (`http://127.0.0.1:27000`
  by default; `--port`, `--host`, `--open`) listing every feature in the
  workspace as a clickable card. Each feature's detail page has a **Diagram**
  tab (flow/swimlane/sequence/event-model, with a view switcher — clicking a
  subflow node jumps to that feature, other nodes scroll-to-highlight in
  **Steps**), a **Steps** table, the raw **Source** YAML, the same **Inspect**
  model `inspect --json` returns, **Diagnostics**, and **Related** (subflow
  calls, dependents, and features connected through a shared event). Nothing
  is written to disk — every route re-reads and re-validates the workspace on
  request, and the page **live-reloads** on every save via Server-Sent Events.
- Diagram click-through reuses the same Mermaid node-id-map click pattern as
  the VS Code preview (`mermaidNodeIdMap`) instead of Mermaid's `click`
  directive, which requires `securityLevel: "loose"` — `securityLevel: "strict"`
  throughout.
- **VS Code**: new **LogicSpec: Start Dashboard** command launches the same
  server and opens it in your default browser.
- New public API: `createDashboardServer` (`src/server/`). New dependency:
  `mermaid` (its prebuilt browser bundle, read from `node_modules` at request
  time — no bundler).

## 0.10.1 — 2026-08-14

A **security patch** for the `$ref` expander. No DSL or API changes; specs are
unaffected.

- **Fix (parser): bound `$ref` expansion output bytes (memory-amplification
  DoS).** `expandFeatureRefs` capped the *depth* and *count* of `$ref`
  resolutions but not the *bytes* cloned. A crafted catalog with one moderately
  large concrete definition (e.g. a 500 KB step template) referenced by a few
  thousand `$ref` nodes in a single feature spent only a fraction of the
  100k-resolution budget yet retained `refs × defSize` bytes — amplifying a
  ~1.5 MB workspace into >1 GB and OOM-aborting the Node process inside
  `structuredClone` (an uncatchable process abort, on every consumer's `validate`
  path). Expansion now enforces a third cap, `MAX_TOTAL_EXPANDED_BYTES` (5 MB of
  cumulative expanded definition content): each concrete definition is measured
  once and, *before* cloning, an expansion that would exceed the budget stops and
  reports **LS112** ("expansion output too large") instead of allocating past it.
  The process can never over-allocate; the diagnostic is always graceful, never a
  throw. Non-`$ref` and small/legitimate `$ref` specs are byte-identical and
  unaffected.

## 0.10.0 — 2026-08-14

An **additive, backward-compatible** extension: **shared definitions** (`$ref`)
for cross-file reuse. Every new field is optional and a feature that uses no
`$ref` is byte-identical through the pipeline, so all existing specs stay valid.

- **New optional catalog `definitions.yaml`** (referenced from
  `logicspec.config.yaml` as `catalogs.definitions`). It holds `actors` — named
  reusable actor definitions (same shape as a feature actor) — and `steps` —
  named reusable **step templates** (a step body without an id: type, label,
  actor and type-specific fields, transitions optional). The catalog path is
  clamped to the workspace root like every other catalog (LS005).
- **`$ref` in features**: a feature actor may be
  `{ $ref: "definitions#/actors/<name>" }`, and a step body may be
  `{ $ref: "definitions#/steps/<name>", …overrides }`. The step's map **key is
  its id**; the resolved template is **shallow-merged** with the local keys and
  **local wins**, so the caller supplies the id and may override or add
  `next`/`on`/fields. Only intra-workspace `definitions#/actors|steps/<name>`
  references are accepted — no arbitrary file/URL refs. Definitions may reference
  other same-section definitions.
- **Expand-on-load**: every `$ref` is resolved into a concrete actor/step in a
  parser pre-pass **before** schema validation, so graph building, all
  validators, the renderers and diff operate on the fully-resolved feature. A
  step template that is invalid after merge (missing field, unknown type) still
  surfaces the ordinary structural diagnostics against the expanded step.
- New diagnostics: **LS110** (`UNKNOWN_REF`, error) — a `$ref` target does not
  exist (with a nearest-name suggestion); **LS111** (`INVALID_REF`, error) — a
  malformed `$ref` string or a section mismatch (an actor slot referencing a
  step, or vice versa); **LS112** (`REF_CYCLE`, error) — shared definitions
  reference each other in a cycle. `docs/validation.md` documents all three.
- Schemas regenerated: new `schemas/definitions.schema.json`, and
  `feature.schema.json` now accepts `$ref` on actors/steps. New public API:
  `parseDefinitions`, `DefinitionsFile`, `Workspace.definitions`. Worked example
  under `examples/shared/`.

## 0.9.1 — 2026-08-13

Security patch. The DSL is unchanged and every valid workspace stays valid.

- **Arbitrary local file read via workspace config (path traversal), fixed.**
  `loadWorkspace` resolved every config-referenced path with a bare
  `path.resolve(root, …)` and then read it, with no check that the result stayed
  inside the workspace root. A crafted `logicspec.config.yaml` (or a service /
  event catalog) could therefore point a `catalogs.services` / `catalogs.events`
  entry, an `openapi`/`asyncapi` `document:`, or the `features.directory` at an
  absolute path or a `../…` escape and make the loader open, parse, and surface
  an arbitrary file from disk. Each of those paths is now clamped to the
  directory containing `logicspec.config.yaml`: a path that escapes the root is
  **refused** (never read or parsed) and reported as new diagnostic **LS005**
  (`UNSAFE_WORKSPACE_PATH`, error), located at the offending config/catalog
  value. Legitimate in-root paths are unaffected — output is byte-identical.
  `docs/validation.md` documents LS005.

## 0.9.0 — 2026-08-13

An **additive, backward-compatible** extension: **agent zones** (and an `agent`
actor kind). Every new field is optional, so all existing specs stay valid.

- **`agent` actor kind**: actor `kind` now includes `agent` alongside `user`,
  `frontend`, `service`, `broker`, `external` and `system`, so a step can be
  owned by an autonomous AI agent actor. It behaves like any other kind and
  reads as its own lane in the swimlane view.
- **Agent zones**: an optional top-level `zones` array demarcates regions of an
  otherwise deterministic flow as **autonomous-agent territory** — a stretch
  that is agent-driven and **order-not-fixed** (Camunda's ad-hoc agent-zone
  pattern). Each zone has a `label`, an optional `description`, an optional
  `kind` (`agent`, the default and only kind for now), and a `steps` list naming
  its member steps. A zone is a pure **annotation**: consistent with the rest of
  the DSL it does **not** change control flow, does not execute, does not
  reorder, and produces no graph edges — it only records which steps sit inside
  the agent's autonomous region.
- New diagnostic **LS309** (`INVALID_ZONE`): every zone `steps` id must resolve
  to a real step (an unknown id is LS309 with a nearest-name suggestion); a step
  belongs to **at most one** zone (overlap is rejected); a zone must name at
  least one step. The construct is bounded to keep validation cheap — at most
  **100 zones** per feature, **1000 steps** per zone, a **200**-character label
  and a **1000**-character description; exceeding any bound is rejected as LS309
  before normalization can amplify it.
- **Rendering & model**: a zone renders as a labelled **subgraph** ("cluster")
  around its member steps, titled `🤖 <label>`; interior steps keep their normal
  shapes and edges. A feature without zones renders byte-for-byte as before.
  Zones are exposed on the normalized model (`NormalizedFeature.zones`), the
  graph (`FeatureGraph.zones`) and the inspect report, and each step carries its
  membership (`NormalizedStep.zone`). Through MCP, `get_feature` lists the zones
  and `get_step` reports the zone a step belongs to. The swimlane, sequence and
  event-model views omit the cluster (the `agent` actor lane still reads in the
  swimlane). New public types `AgentZone`, `NormalizedZone`, `GraphZone`,
  `AgentZoneKind` and the `AGENT_ZONE_LIMITS` constant are exported.
- New `examples/triage/` exercises an AI incident-triage region;
  `docs/step-types.md`, `docs/specification.md` and `docs/validation.md` document
  the construct, the `agent` kind and LS309.

### Fixes (post-review hardening, still 0.9.0)

- **Mermaid label injection via carriage return**: `escapeMermaid` stripped `\n`
  but left a bare `\r` (or `\r\n`) intact, so a label containing `\r%%` could
  start a fresh Mermaid line that opens a comment and breaks the diagram. Every
  line-break form now collapses to a single space. Affects **all** labels, not
  only agent zones.
- **Suggestion-cost amplification (DoS)**: every unresolved reference (agent-zone
  member, decision-table `next` cell, boundary/transition target) ran a
  Levenshtein "did you mean" scan over the full step set, so a document with many
  bad references cost O(references × steps) and could block the validator for
  ~18s. Suggestion computation is now bounded by a per-validation-run budget
  (500): once spent, further unresolved-reference diagnostics are still reported
  but without a suggestion, capping total suggestion work at O(budget × steps).
  Normal specs are far below the budget and keep every suggestion.
- **Agent-zone subgraph id collision**: the flowchart renderer emitted the zone
  cluster with a hardcoded `zone_<i>` id, which could collide with a step
  legitimately named `zone_0`. The subgraph id is now reserved through the same
  `NodeIdAllocator` as step nodes, so the two can never share an identifier
  (output is byte-identical when no such step exists).
- **Mermaid label injection via carriage return, second path (sequence view)**:
  the sequence-diagram renderer's participant-name sanitizer had its own
  `\r?\n` newline normalization, separate from `escapeMermaid`, which likewise
  left a bare `\r` intact — so a `\r%%` actor label could still inject a
  Mermaid comment line in the sequence view even after the fix above. It now
  reuses the same shared newline-normalizing helper as `escapeMermaid`
  (`normalizeMermaidNewlines`), so every renderer collapses `\n`, `\r` and
  `\r\n` identically from one source of truth.

## 0.8.0 — 2026-08-13

An **additive, backward-compatible** extension: **boundary events**. Every new
field is optional, so all existing specs stay valid.

- **Boundary events**: a `subflow`, `page` or `parallel` step may carry an
  optional `boundary` array — documented alternative paths taken when the step
  **times out, errors, or receives a message/condition while in progress**
  ("if this step runs past its SLA / fails mid-flight / is interrupted, divert
  here"). Boundaries attach **only** to those three step types: they fill the
  gap for a called sub-process past its SLA, a user page that times out, and a
  concurrent region exceeding an SLA. Step types that already carry outcome maps
  are excluded — `operation`/`subflow` use `on:`, a waiting `event` uses
  `on.timeout`, a `wait` is itself the delay — so a boundary there is rejected
  rather than adding a second way to say the same thing.
- **Reuses the typed-event vocabulary**: each handler has an `eventKind`
  (`timer` with `after`/`at`/`every`, `message`/`signal` with `event`, `error`
  with an optional `name`, `conditional` with `when`), a required `next` target,
  an optional `label`, and `interrupting` (default `true`). An interrupting
  handler diverts the flow; a non-interrupting one spawns a parallel descriptive
  path. Consistent with the rest of the DSL, a boundary is **descriptive and
  never evaluated or scheduled** — the tool never fires a timer or tests a
  condition.
- New diagnostic **LS308** (`INVALID_BOUNDARY`): rejects a boundary on a
  disallowed step type, and enforces per-kind field consistency with the same
  rules typed events use (LS305), including the non-blank-required-field rule.
  The event and boundary per-kind checks now share one implementation.
- **Targets & reachability**: a boundary's `next` flows through the normal
  transition machinery in `normalize.ts`, so an unresolved target is **LS101**
  and a step reachable only through a boundary is reachable for **LS200**.
- **Rendering & model**: each handler renders as a **plain labelled edge** to
  its target (not a BPMN attached-circle glyph), marked `⏱ after 30d`,
  `⚠ on-error`, `✉ on-message …`, or `? when …`, with a `(non-interrupting)`
  suffix where applicable. Boundaries are exposed on the graph node
  (`GraphNode.boundaries`) and the full authored handlers via MCP `get_step`.
  New public types `BoundaryHandler`, `GraphBoundary`, the `boundary` edge kind,
  and the `BOUNDARY_STEP_TYPES` constant are exported.
- New `examples/fulfillment/` exercises boundaries on all three host types;
  `docs/step-types.md` and `docs/validation.md` document the construct and LS308.

Hardening of the boundary-events feature after review (pre-release fixes, no
version bump — the DSL is unchanged and every valid boundary stays valid):

- **Bounded boundaries (resource-exhaustion guard).** A step's `boundary` array
  is now capped at **1000 handlers**, and each descriptive field (`after`/`at`/
  `every`/`name`/`when`/`label`) at **500 characters**. The bounds live in the
  schema, so an over-limit document is rejected as **LS308** before
  normalization/graph work can amplify thousands of handlers pointing at
  unresolved targets into a quadratic "did you mean" pass and hang the validator.
- **Catalog-checked boundary event names.** A `message`/`signal` boundary
  handler's `event` name now resolves against the event catalog exactly like an
  event step's — an unknown name is **LS105** with a nearest-name suggestion,
  matching the boundary schema's documented contract.
- **Object-input `validateFeature()` never throws.** A hand-built object with a
  malformed boundary (e.g. `boundary: [null]`) is now Zod-gated and returns
  diagnostics instead of throwing. The YAML/MCP path was already schema-gated.

## 0.7.0 — 2026-08-13

An **additive, backward-compatible** extension: **decision tables**. Every new
field is optional, so all existing specs stay valid.

- **Decision tables with hit policies**: a `decision` step may carry an optional
  `decisionTable` — a [DMN](https://www.omg.org/dmn/)-style grid — instead of
  free-form `cases`. It declares `inputs` (columns being tested), `outputs` (at
  least one result column), a `hitPolicy` (`unique` (default), `first`,
  `priority`, `any`, `collect`, `ruleOrder`, `outputOrder`), and `rules` (rows
  with one `when` cell per input and one `then` cell per output). Consistent with
  the rest of the DSL, the cells are **descriptive and never evaluated** and the
  hit policy is a **declarative label**, not an evaluator — LogicSpec stays a
  specification tool, not a runtime.
- **Target-column convention**: a reserved `next` output column names the target
  step for each rule, so a table-driven decision produces one branch per rule and
  stays a real flow. Those targets flow through the normal transition machinery,
  so unresolved targets are **LS101** and reachability (**LS200**) treats table
  branches like any other edge. Omit the `next` column for a pure
  classification/output table that continues through the decision's `default`.
- New diagnostic **LS307** (`INVALID_DECISION_TABLE`): rejects a table combined
  with `cases`, a table with no outputs or no rules, and any rule whose `when` /
  `then` width does not match the declared inputs / outputs. `decisionTable` and
  `cases` are mutually exclusive.
- **Rendering & model**: the flowchart node keeps the decision diamond but its
  marker becomes `DECISION TABLE · <HIT POLICY> · N rules`, with each rule
  rendered as a branch labelled by its descriptive outputs. The table summary is
  exposed on the graph node (`GraphNode.decisionTable`) and the full rule grid is
  available via the authored step definition (MCP `get_step`). New public types
  `DecisionTable`, `DecisionRule`, `HitPolicy` and the
  `DECISION_TABLE_TARGET_COLUMN` constant are exported.
- New `examples/pricing/` demonstrates a decision table; `docs/step-types.md` and
  `docs/validation.md` document the construct and LS307.

Also fixed: a **forbidden** event field that was present but blank (e.g. a
`timer` with `name: ""`) slipped past **LS305**, because the forbidden-field
check used blank-aware presence. Forbidden-field checks now test raw presence;
required-field checks stay blank-aware.

Hardening of the decision-table feature after review (all under **LS307**, no
version bump — the DSL is unchanged and every valid table stays valid):

- **Bounded tables (resource-exhaustion guard).** A decision table is now capped
  at **1000 rules**, **50 input columns**, **50 output columns**, and **500
  characters per header or cell**. Free-form `cases` gets a matching **1000**
  cap. The bounds live in the schema, so an over-limit document is rejected
  before normalization/graph work can amplify it. Over-limit tables report
  **LS307**; over-limit `cases` report LS002.
- **Suggestion cost cap.** `suggest()` (the "did you mean" helper) now skips
  Levenshtein for any name or candidate longer than 64 characters, so an
  attacker-controlled long target (e.g. a 300-character decision-table `next`
  cell) can no longer make suggestion generation quadratic and hang the
  validator. This protects both decision-table targets and `cases`.
- **Classification tables must continue.** A table with no reserved `next`
  column **and** no `default` produced zero outgoing transitions — a silent dead
  end. It is now **LS307**. A table with a `next` column, or one with a
  `default`, is unaffected.
- **At most one `next` column.** A table whose `outputs` name `next` more than
  once is now **LS307** (previously only the first column was honored).
- **Blank/`-` targets get a dedicated message.** A `-` or blank cell in the
  reserved `next` column now reports a dedicated **LS307** ("must name a real
  step") instead of a generic LS101 unknown-target error.
- **Mermaid `%%` escape.** `escapeMermaid` now neutralizes `%` (to `#37;`), so a
  `%%` in any label, header, cell or target can no longer open a Mermaid comment
  and break that diagram line. Applies to all labels, not just tables.

## 0.6.0 — 2026-08-13

Three **additive, backward-compatible** vocabulary extensions. Every field is
optional, so all existing specs stay valid.

- **Typed events**: an optional `eventKind` classifies an `event` step as
  `timer`, `message`, `signal`, `error` or `conditional`. Timers carry exactly
  one of `after` / `at` / `every` (`after`/`every` reuse the `wait` duration
  format); message/signal keep the `event` name; error takes an optional
  `name`; conditional takes a descriptive `when`. New diagnostic **LS305**
  (`INVALID_EVENT_KIND`) enforces per-kind consistency; an unknown `eventKind`
  is an LS002 schema error. The kind shows in the diagram marker
  (`EVENT · TIMER`).
- **Typed terminal states**: `final` steps accept an optional
  `terminate: boolean` (default `false`) meaning "end the whole flow instance,
  not just this path". A final's `kind` (`normal` / `error` / `terminate`) is
  derived, not stored. A terminated final gets a distinct diagram marker
  (`⦻ TERMINATE`).
- **Transition guards**: an optional descriptive `when` predicate (never
  evaluated, like a decision `cases[].when`) can annotate operation and subflow
  `on:` outcomes and page `actions`. Guards render on the edge label as
  `[when: …]`.
- New `examples/reminders/` demonstrates all three constructs; `docs/step-types.md`
  and `docs/validation.md` document the new fields and LS305.

Pre-release hardening of the same `0.6.0` vocabulary (no DSL change):

- **Object-input validation** now runs the file-local structural checks
  (LS301–LS306) too — previously `validateFeature()` on an already-parsed
  object skipped them, so LS305 could be bypassed programmatically.
- **LS305 hardened**: required per-kind event fields must be **non-blank** (an
  empty `event`/`when`/`at` no longer satisfies the requirement), and a
  `timer`/`conditional` event must use `direction: wait` (they are catch
  events and cannot be published).
- **LS306** (`BLANK_GUARD`): a descriptive `when` guard on an operation/subflow
  outcome or a page action that is present but blank is now rejected.
- **Error terminals render distinctly**: a `final` with `outcome: failure`
  (and no `terminate`) now shows `⊗ ERROR`, completing the
  normal / error / terminate three-way. The derivation is the single canonical
  `finalKind()`, now exported from the public API.
- `after` / `every` timer fields document that they are descriptive, never
  scheduled.

## 0.5.11 — 2026-08-11

- Showcase screenshot (a real booking flow on the interactive canvas) in
  the README and the Marketplace listing.

## 0.5.10 — 2026-08-10

- Project logo: banner in the README, square icon and light gallery banner
  on the VS Code Marketplace listing.

## 0.5.9 — 2026-08-10

- **Interactive canvas view in VS Code (new default)**: the preview's
  "interactive" view renders on React Flow + dagre — professional node
  dragging (edges follow properly), zoom/pan, minimap and controls.
  Hovering a step spotlights it and its direct relations while everything
  unrelated fades; actors get stable deterministic colors (node accent,
  pill, minimap and a hover-aware legend); nodes carry requires/produces
  context chips. Single/double click semantics and the details drawer
  carry over. Positions remain view-only. The hand-rolled SVG node-drag
  from 0.5.7 is removed. Mermaid views stay available in the switcher.

## 0.5.8 — 2026-08-10

- **Step inspector in the VS Code preview**: single-clicking a node opens a
  details drawer with the step's complete data (actor, call, event, flow,
  requires/produces, durations, tags, …) and every outgoing transition.
  Cross-file links open the exact location: the `services.yaml` operation,
  the `events.yaml` event, or the referenced subflow's feature file;
  transition entries jump to their target step. Double-click keeps the
  direct jump-to-definition. In the workspace graph, single and double
  click both open the feature's file.

## 0.5.7 — 2026-08-10

- **Movable nodes in the VS Code panels** (n8n-style, view-only): drag any
  step to reposition it — connected edges re-route as border-clipped
  straight lines and their labels follow. Positions are never stored; the
  new **Reset** button (or any re-render) restores Mermaid's automatic
  layout. Node dragging, background panning, zooming and click-to-navigate
  coexist via pointer-target routing and a shared drag threshold.

## 0.5.6 — 2026-08-10

- **Zoom & pan in the VS Code panels** (feature preview and workspace
  graph): Ctrl/Cmd+wheel zooms at the cursor, drag pans, toolbar gains
  − / % / + / Fit controls (% resets to 100%). Implemented by sizing the
  SVG directly so native scrolling does the panning and node clicks keep
  working; a drag suppresses the following click. Fit-to-panel remains
  the default and re-fits on panel resize.

## 0.5.5 — 2026-08-10

- **Clickable diagrams in VS Code**: clicking a node in the feature preview
  jumps to (and selects) that step's YAML definition; clicking a feature in
  the workspace graph opens its file. Implemented with a strict-CSP-safe
  delegated listener — no Mermaid `securityLevel: loose`.
- New public helpers `mermaidNodeIdMap` and `workspaceGraphNodeIdMap`
  expose the renderers' node-id allocation for interactive hosts.

## 0.5.4 — 2026-08-10

- VS Code extension is now a complete no-files experience:
  - view switcher inside the preview panel (flow / swimlane / sequence /
    event-model) — per-panel, no settings editing;
  - `LogicSpec: Preview Workspace Graph` — live dependency graph panel
    (subflow + event edges), refreshed on save, never written to disk;
  - README states the extension is fully self-contained (core bundled;
    the npm CLI is only for terminal/CI/MCP use).

## 0.5.3 — 2026-08-10

- **Preview rendering fix** (VS Code extension and Obsidian plugin): Mermaid's
  HTML labels serialize as non-XML (`<foreignObject>` with unclosed `<br>`),
  so the strict `image/svg+xml` safety parse rejected every diagram
  ("Renderer returned unexpected content."). Output is now parsed as HTML
  with the `<svg>` element extracted, and the VS Code preview additionally
  renders with pure-SVG labels (`flowchart.htmlLabels: false`). A jsdom
  regression test pins both halves of the failure mode.

## 0.5.2 — 2026-08-10

- **VS Code extension fix**: the 0.5.0/0.5.1 bundles crashed at load
  ("command 'logicspec.previewFeature' not found") because a module-scope
  `createRequire(import.meta.url)` in the bundled core became
  `createRequire(undefined)` under esbuild's CJS lowering. Version lookup
  is now lazy and guarded, and a bundle-load regression test activates the
  real built bundle against a stubbed VS Code host in CI.
- License changed from MIT to Apache-2.0 (artifacts published before
  0.5.2 immutably carry the license recorded at their publish time).
- README: Claude Code plugin installation guide.

## 0.5.1 — 2026-08-10

- `logicspec export` — full workspace artifact build (per-feature Markdown
  and JSON models, dependency graph, workspace index, diagnostics) into the
  output directory.
- Output directory default changed from `./generated` to `./.logicspec`
  (a root dot-folder in the `.next` tradition). Set
  `output.directory: ./generated` in `logicspec.config.yaml` to keep the
  old location.
- VS Code extension: explorer/editor context-menu preview entries (working
  on unopened files), `Ctrl+Shift+V` / `Cmd+Shift+V` preview keybinding
  scoped to feature files.
- Dev-dependency updates (esbuild ≥ 0.25 advisory).

## 0.5.0 — 2026-08-10

Roadmap milestones v0.2 through v0.5 in one release.

### Language & catalogs

- Service catalog operations may link into OpenAPI documents
  (`openapi: { document, operationId }`); events may link into AsyncAPI
  documents (`asyncapi: { document, channel }`). References are verified.
- Workspace config gains per-code severity overrides:
  `diagnostics: { LS200: "error", LS402: "off" }`.

### Validation

- **Data-flow analysis** (LS203): every `requires` must be produced on every
  path from `start` — must-availability fixpoint over the graph.
- Subflow outcome contracts (LS404): `on:` keys are checked against the
  target feature's final outcomes.
- Unused declarations: context variables (LS401) and actors (LS402), info.
- OpenAPI/AsyncAPI reference checks: LS108, LS109, plus method/path
  mismatch warnings (LS403).
- Diagnostics now carry end positions (`endLine`/`endColumn`) for editors.

### Views & tooling

- New experimental Mermaid views: `--view sequence` and `--view event-model`.
- `logicspec graph` — workspace dependency graph (features, subflows,
  event publish/wait edges, optional service nodes).
- `logicspec diff <before> <after>` — semantic feature diff (steps,
  transitions, actors, context, outcomes), `--json` for tooling.
- `logicspec validate` with no paths validates the whole workspace;
  `--json` emits a stable machine-readable report.
- `logicspec watch` re-renders subflow dependents of a changed feature.

### Integrations

- **MCP server** (`logicspec mcp`): dependency-free stdio JSON-RPC server
  exposing seven tools (`list_features`, `get_feature`, `get_step`,
  `get_transitions`, `get_service_dependencies`, `get_events`,
  `validate_feature`) to AI agents.
- **VS Code extension** (`integrations/vscode/`, experimental): inline
  diagnostics with exact ranges and a live Mermaid preview panel.
- **Visual editor** (`integrations/editor/`, experimental): React Flow
  canvas with two-way YAML ↔ graph editing, node palette and inspector,
  backed by the new document-preserving edit API.
- **Obsidian plugin** (`integrations/obsidian/`, experimental): renders
  `logicspec` / `logicspec-file` code blocks as validated diagrams in notes.
- **Claude Code plugin** (`integrations/claude-plugin/`): authoring skill,
  `/logicspec:feature` and `/logicspec:check` commands, MCP wiring;
  installable via the repo's plugin marketplace manifest.
- New `logicspec/core` subpath export: the browser-safe, fs-free API
  surface used by web tooling.
- New public edit API (`loadEditableFeature`, `addStep`, `renameStep`,
  `addTransition`, …) that preserves YAML comments and formatting.

## 0.1.0 — 2026-08-09

Initial release: DSL v1 (nine step types), parser, structural + semantic
validation with stable LS diagnostics, Mermaid flowchart and experimental
swimlane renderers, Markdown wrapper, CLI (`init`, `validate`, `render`,
`inspect`, `watch`), JSON Schemas generated from the Zod sources, booking
example workspace, test suite and CI.
