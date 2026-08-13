# CLAUDE.md

LogicSpec — a YAML DSL for describing application feature logic, plus the toolchain (v0.5.0): parse → validate → normalize → graph → render (Mermaid) → inspect/diff/edit, with an MCP server and experimental VS Code + visual-editor integrations. TypeScript, ESM, Node ≥ 20, Zod 4, Vitest, Biome. This is a design/specification tool, **not** a workflow engine: nothing in a YAML document is ever executed.

Keep this file in sync with `AGENTS.md` (same substance, tool-neutral wording).

## Commands

```bash
npm run typecheck   # tsc --noEmit (src + tests + scripts)
npm run lint        # Biome
npm test            # Vitest
npm run build       # compile to dist/
npm run schemas     # regenerate schemas/*.schema.json (run after changing src/schema/)
node dist/cli/main.js <cmd>   # run the CLI without npm link
```

CLI commands: `init` · `validate [paths...] [--strict] [--json]` (no paths = whole workspace) · `render <paths...> [--view flow|swimlane|sequence|event-model] [--format md|mermaid] [--direction TD|TB|LR|RL|BT] [--output]` · `export [dir]` (full artifact build into .logicspec/) · `inspect <paths...> [--json]` · `watch [dir]` (re-renders subflow dependents) · `graph [dir] [--services]` · `diff <before> <after> [--json]` · `mcp [dir]`. Exit codes: 0 ok, 1 validation errors, 2 parse/config/usage errors (diff: 0 even when different).

## Architecture (pipeline order)

| Layer | Path | Role |
|-------|------|------|
| Schemas | `src/schema/` | Zod schemas = canonical DSL shape; JSON Schema generation |
| Parser | `src/parser/` | YAML → value + path→line/col(+end) locator; `expand-refs.ts` resolves `$ref` shared definitions before schema; Zod issues → diagnostics |
| Graph | `src/graph/` | `normalize.ts` (normalized model + ALL transition discovery), `edges.ts` (FeatureGraph), `reachability.ts` (BFS, Tarjan SCC), `dataflow.ts` (must-availability, LS203) |
| Validator | `src/validator/` | `structural.ts` (file-local), `semantic.ts` (cross-refs + graph + unused + subflow contracts), `catalogs.ts` (OpenAPI/AsyncAPI refs, workspace-level), `validate.ts` (orchestrator + severity overrides), `stats.ts` |
| Renderers | `src/renderers/` | flowchart (stable); swimlane, sequence, event-model (experimental); workspace graph; Markdown wrapper |
| Diff | `src/diff/` | semantic feature diff (`diffFeatures`, `formatFeatureDiff`) |
| Edit | `src/edit/` | comment/format-preserving `yaml`-Document mutations (two-way editing) |
| MCP | `src/mcp/` | dependency-free stdio JSON-RPC server, 7 tools |
| Workspace | `src/workspace/` | config discovery, catalog (services/events/definitions) + API-doc loading, flow index, `featureDependents` |
| CLI | `src/cli/` | Commander commands; thin layer over the library |
| Diagnostics | `src/diagnostics/` | LS codes, Diagnostic type, nearest-name suggestions |
| Integrations | `integrations/vscode/`, `integrations/editor/` | self-contained packages (own package.json — install/build/test INSIDE the dir); bundle core from `../../src` via alias, never from dist |

Public API = exports of `src/index.ts`; browser-safe subset = `src/core.ts` (`logicspec/core`). Everything else is internal.

## Core rules (violations are bugs)

1. **Nine step types, closed set**: `page`, `decision`, `operation`, `event`, `wait`, `subflow`, `parallel`, `error`, `final`. Never invent step types or properties; org-specific data goes under namespaced `extensions:` (keys contain `/`).
2. **Diagnostic codes (LS001–LS404) are stable**: never renumber or reuse; new checks get the next free number in the right band (0xx files, 1xx references, 2xx graph, 3xx structure, 4xx advisory). Document new codes in `docs/validation.md`.
3. **Deterministic output**: nodes/edges in source order; same YAML → byte-identical render. No randomness, no timestamps in generated content.
4. **Renderers are pure**: objects in, strings out; no `fs` outside `src/cli/`, `src/workspace/`, `src/mcp/`.
5. **Validation returns `Diagnostic[]`**: no console output outside `src/cli/` (MCP logs go to stderr only — stdout is protocol).
6. **Never execute YAML content**: `expression`, `when`, labels, notes are opaque data. No `eval`/`new Function`/shell with user input. Escape every user string in Mermaid output (`escapeMermaid`).
7. **All transition discovery lives in `src/graph/normalize.ts`**: validators and renderers consume `transitions`/`FeatureGraph`, never re-interpret raw step shapes.
8. **`schemas/` is generated** — edit `src/schema/*.ts`, then `npm run schemas`. Never hand-edit JSON Schemas.
9. **Generated Markdown is never hand-edited**; YAML feature files are the source of truth. Mermaid is documentation.
10. `next` XOR `on` (operation/subflow); event `publish`→`next`, `wait`→`on.received`; final steps have no outgoing transitions.
11. **`src/core.ts` stays fs-free**: never re-export `workspace/`, `cli/` or `mcp/` from it — the visual editor bundles it for the browser.
12. **Edit mutations preserve documents**: everything in `src/edit/` operates on the `yaml` Document and must keep comments, key order and formatting of untouched content intact.
13. Severity overrides (config `diagnostics:`) change severity/visibility only — never emit different codes to satisfy an override.

## Feature YAML as source of truth (for product repos using LogicSpec)

Before implementing or modifying a feature: read the relevant `features/*.feature.yaml`, run `logicspec validate`, identify affected pages / operations / events / error paths, implement without contradicting the spec, run tests, validate again. Never infer behavior from generated Mermaid when the YAML disagrees — the YAML wins. Agents can query the workspace via `logicspec mcp` or `inspect --json` instead of parsing YAML.

## Testing

Tests mirror `src/` under `tests/`. Renderer output is snapshot-tested — review snapshot diffs like code. `examples/booking/` is the canonical workspace (two features, OpenAPI/AsyncAPI-linked catalogs, severity override); every step-type or schema change should keep it valid: `node dist/cli/main.js validate examples/booking`. Integration packages have their own suites — run them inside `integrations/*/`.
