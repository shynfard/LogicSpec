# CLAUDE.md

LogicSpec — an open-source, AI-native Application Definition Language: application behavior defined declaratively in YAML, validated, visualized, queried by AI agents, and eventually used to generate software.

Keep this file in sync with `AGENTS.md` (same substance, tool-neutral wording).

## Current phase: 0 — Specification only

- **Do not write executable code** — no indexer, CLI, VS Code extension, or MCP server. Those are Phases 1–4 (`docs/roadmap.md`).
- The only machine-readable artifact is `schema/logicspec-0.1.schema.json`.
- The deliverable is precise documentation. Normative language uses RFC-2119 keywords (MUST/SHOULD/MAY).

## Doc map

| File | Read when |
|------|-----------|
| `docs/specification.md` | **Source of truth.** Any question about syntax, kinds, IDs, references |
| `docs/workspaces.md` | Workspace model, root manifest, distributed files |
| `docs/modules.md` | Modules, membership, derived module views |
| `docs/discovery.md` | Discovery algorithm, workspace index |
| `docs/references.md` | Identity-based references, uniqueness, diagnostics catalog |
| `docs/vscode-extension.md` | Future editor experience (design only) |
| `docs/ai-integration.md` | MCP tool surface, agent authoring rules, skill design |
| `docs/vision.md`, `docs/roadmap.md` | Positioning and phases |
| `docs/open-questions.md` | Unresolved design decisions — add here rather than inventing semantics |
| `docs/superpowers/` | Internal process specs/plans, not public spec content |

## Core rules (violations are bugs)

1. Every LogicSpec document starts `logicSpec: "0.1"` + `kind:` (`workspace|module|feature|service|events`), body key matches kind.
2. IDs kebab-case; event names PascalCase.
3. References use **identity, never file paths** (`module: booking`, `call: booking-service.reserve-slot`).
4. Exactly six step types: `page`, `operation`, `decision`, `publish`, `wait`, `outcome`. Closed set — never invent step types or keys.
5. **Never write derived state** (module lists, counts, indexes) into `logicspec.yaml` or any document. The root manifest is configuration only.
6. Physical file location never determines identity.

## Editing docs

- `docs/specification.md` wins on conflict; other docs link to it rather than restating normative rules.
- Every YAML snippet in docs must validate against the schema (envelope-only fragments excepted).
- One concept per doc; cross-link with relative links.
- New unresolved design questions go to `docs/open-questions.md` — don't resolve them ad hoc.

## Example workspace

`examples/salon-platform/` — 12 documents, deliberately scattered across `domains/`, `backend/`, `contracts/`. Every v0.1 construct appears at least once. After changing examples or schema, validate:

```bash
python3 -c "
import glob,json,yaml,jsonschema
s=json.load(open('schema/logicspec-0.1.schema.json'))
fs=['examples/salon-platform/logicspec.yaml']+sorted(glob.glob('examples/salon-platform/**/*.logic.yaml',recursive=True))
[jsonschema.validate(yaml.safe_load(open(f)),s) for f in fs]
print(f'{len(fs)} documents PASS')"
```

Example files carry `# yaml-language-server: $schema=...` headers — keep relative paths correct when moving files.
