# Contributing to LogicSpec

Thanks for your interest! LogicSpec is small on purpose — a tight DSL, excellent validation, deterministic rendering. Contributions that keep it small are the most welcome kind.

## Development setup

```bash
git clone <this repository>
cd logicspec
npm install
```

Everyday commands:

```bash
npm run typecheck   # tsc --noEmit over src, tests and scripts
npm run lint        # Biome
npm test            # Vitest
npm run build       # compile to dist/
npm run schemas     # regenerate schemas/*.schema.json from the Zod schemas
npm link            # make the `logicspec` CLI available globally
```

Before opening a PR, make sure all four of typecheck, lint, test, and build pass, and run the CLI against `examples/booking/`.

## Project layout

```text
src/
  schema/       Zod schemas — the canonical shape of the DSL (+ JSON Schema generation)
  parser/       YAML loading, Zod issue mapping, parse entry points
  graph/        normalized model, graph construction, reachability/SCC analysis
  validator/    structural rules, semantic (cross-reference + graph) checks, stats
  renderers/    Mermaid flowchart, experimental swimlane, Markdown wrapper
  workspace/    config discovery, catalog + feature loading
  cli/          Commander commands; thin layer over the library
  diagnostics/  diagnostic codes, types, nearest-name suggestions
  index.ts      the public API — only what's exported here is stable
tests/          Vitest suites mirroring src/
schemas/        generated JSON Schemas (never edit by hand; run npm run schemas)
examples/       runnable example workspaces (booking is canonical)
docs/           specification, step types, validation, roadmap
```

Architecture rules that keep the codebase healthy:

* Renderers take objects and return strings — no file system access.
* Validation returns `Diagnostic[]` — no console output outside `src/cli/`.
* All transition discovery happens in `graph/normalize.ts`; nothing downstream re-interprets raw step shapes.
* Output is deterministic: source order in, same bytes out.

## How to…

### Add a step type

Think twice — the closed vocabulary is the product. If it's genuinely needed:

1. Discuss it in an issue first (see "Propose DSL changes").
2. Add the schema in `src/schema/feature.ts` and extend `STEP_TYPES`.
3. Add transition extraction in `src/graph/normalize.ts`.
4. Add structural rules (`src/validator/structural.ts`) and semantic checks (`src/validator/semantic.ts`) as needed.
5. Pick a shape in `src/renderers/mermaid-common.ts`.
6. Update `docs/specification.md` and `docs/step-types.md`.
7. Add parser, validator, and renderer tests; extend the booking example if it fits naturally.
8. Run `npm run schemas`.

### Add a validation rule

1. Register a new code in `src/diagnostics/codes.ts`. Codes are stable: **never renumber or reuse one**; pick the next free number in the right band (LS0xx files, LS1xx references, LS2xx graph, LS3xx structure, LS4xx advisory).
2. Implement the check in `structural.ts` (file-local) or `semantic.ts` (cross-reference/graph).
3. Give the message a precise document path and, where it helps, a suggestion.
4. Document it in `docs/validation.md`.
5. Add tests for both the failing and the passing case.

### Add a renderer

1. Create `src/renderers/<name>.ts` that consumes `NormalizedFeature`/`FeatureGraph` and returns a string.
2. Reuse `mermaid-common.ts` escaping/id allocation if it's a Mermaid dialect.
3. Keep it deterministic; add snapshot tests plus escaping tests (quotes, parentheses, Unicode, `&`, `<`, `>`).
4. Wire it into `renderMermaid`/CLI only when it's solid — experimental is fine if labeled.

### Add tests

Tests live in `tests/`, mirroring `src/`. Prefer small inline YAML fixtures; use the booking example for integration-level coverage. Renderer output uses snapshot testing — review snapshot diffs like code.

### Propose DSL changes

The language evolves by need, not speculation:

1. Open an issue using the *DSL proposal* template before writing code.
2. Additive, non-breaking ideas may land within version 1.
3. Anything changing existing semantics requires DSL `version: "2"` — v1 documents keep their meaning forever.
4. Prefer references over duplication, keep it declarative, and remember: major behavior deserves a graph node; UI-local state does not.

## Code style

TypeScript, ESM, strict mode. Biome enforces formatting — run `npm run lint:fix` and don't argue with the formatter. Match the surrounding code's naming and comment density; comments explain constraints, not narration.

## Reporting bugs

Use the bug report template. The most useful bug report contains a minimal `*.feature.yaml` that reproduces the problem plus the exact CLI output.

## Code of conduct

Be kind. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
