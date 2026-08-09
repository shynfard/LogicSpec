# LogicSpec Phase 0 — Workspace Model, Core DSL v0.1, and AI-Native Documentation Set

**Date:** 2026-08-09
**Status:** Approved design, pre-implementation
**Phase:** 0 (documentation-only — no executable code, JSON Schema permitted as declarative spec)

## Goal

Turn the LogicSpec repository (currently README + LICENSE) into a complete Phase 0 specification workspace: a normative core DSL definition, the distributed-workspace model, tooling/VS Code/AI-integration design docs, a machine-readable JSON Schema, a realistic multi-directory example workspace, and repo-level agent instructions (CLAUDE.md / AGENTS.md) so Claude Code, Codex, and similar tools work well in this repo from day one.

## Non-Goals

- No indexer, CLI, VS Code extension, or MCP server implementation (Phases 1–4).
- No code generation (Phase 5).
- No external-module/import syntax (documented as future work only).
- No complex namespace semantics (tracked as open question).

## 1. Core DSL v0.1

### Document envelope

Every LogicSpec document is a YAML file matching `*.logic.yaml` (workspace root is `logicspec.yaml`) and starts with:

```yaml
logicSpec: "0.1"
kind: workspace | module | feature | service | events
module: <module-id>   # module membership; used by feature/service/events kinds
```

Physical location never determines identity. Identity comes from IDs; membership comes from the `module:` key.

### Document kinds (v0.1)

| Kind | Purpose | Body key |
|------|---------|----------|
| `workspace` | Root manifest + discovery config | `workspace:` |
| `module` | Logical application area (booking, payment…) | `module:` |
| `feature` | User-facing flow of steps | `feature:` |
| `service` | Backend service with operations | `service:` |
| `events` | Event definitions (name + payload) | `events:` |

Future kinds (`entities`, `policies`, `integration`, `application`, `architecture`) are named but not normatively defined.

### Feature model

```yaml
feature:
  id: create-booking
  name: Create Booking
  description: >
    Optional prose.
  actors: [customer]
  context:            # named data carried through the flow (informal types in v0.1)
    service: Service
    slot: Slot
  start: select-service
  steps:
    <step-id>: ...
```

Step types:

| Type | Purpose | Key fields |
|------|---------|-----------|
| `page` | UI state presented to an actor | `actions: {action-name: target-step}` |
| `operation` | Call a service operation | `call: <service-id>.<operation-id>`, `on-success`, `on-error: {error-id: target-step}` |
| `decision` | Branch on a condition | `when:` (prose condition), `branches: {case-name: target-step}` |
| `publish` | Emit an event | `event: <EventName>`, `next` |
| `wait` | Suspend until an event arrives (async workflows) | `event: <EventName>`, `next`, optional `timeout` → target step |
| `outcome` | Terminal state | optional `result: success | failure | cancelled` (informal) |

All step transitions reference step IDs within the same feature. Unreachable steps, unknown targets, and undefined operations/events are diagnostics for future tooling (documented now).

### Service model

```yaml
service:
  id: booking-service
  name: Booking Service
  operations:
    reserve-slot:
      description: Reserve a time slot.
      input: { slot: Slot }        # informal shapes in v0.1
      output: { reservation: Reservation }
      errors: [slot-conflict]
      publishes: [BookingCreated]
```

### Events model

```yaml
events:
  BookingCreated:
    description: A booking was successfully created.
    payload:
      bookingId: string
```

### Identifier and reference rules

- Modules, features, services, operations, steps, errors: `kebab-case`.
- Events: `PascalCase`.
- References always use identity, never file paths: `module: booking`, `call: booking-service.reserve-slot`, `event: BookingCreated`, `next: checkout`.
- v0.1 uniqueness: module IDs globally unique; feature/service IDs globally unique within the workspace; event names globally unique; step IDs unique within a feature; operation IDs unique within a service. Future namespacing (`booking/create`) is an open question — do not invent it now.

### Workspace manifest

```yaml
logicSpec: "0.1"
kind: workspace
workspace:
  id: salon-platform
  name: Salon Platform
discovery:
  include: ["**/*.logic.yaml"]
  exclude: ["node_modules/**", ".git/**", "dist/**", "build/**"]
```

Exactly one workspace document per workspace. The root file is configuration, not generated state — tooling must never write derived indexes (module lists, counts) back into it.

## 2. Documentation set

Create under `docs/`:

| File | Content |
|------|---------|
| `vision.md` | Spec-as-source vision, AI-native positioning, what LogicSpec is/is not |
| `terminology.md` | Glossary: workspace, document, kind, module, feature, step, service, operation, event, workspace index, discovery |
| `specification.md` | Normative core DSL v0.1 (envelope, kinds, feature/service/events models, ID + reference rules) using RFC-2119 MUST/SHOULD language |
| `workspaces.md` | Workspace model, root manifest, single-workspace rule, root-is-configuration principle |
| `modules.md` | Module documents, membership, derived module trees |
| `discovery.md` | Discovery semantics: locate root → match globs → parse metadata → build index → resolve references → report problems; derived-index prohibition |
| `references.md` | Identity-based referencing, resolution rules, uniqueness, diagnostics for unresolved/duplicate identities |
| `vscode-extension.md` | Full future extension design: Explorer tree, navigation, Go to Definition, Find References, overviews, graph, diagnostics, outline, hover, CodeLens, incremental indexing, file watching |
| `ai-integration.md` | MCP tool surface (`get_workspace`, `list_modules`, `get_module`, `list_features`, `get_feature`, `get_service`, `get_operation`, `get_event`, `find_references`, `get_dependencies`, `validate_workspace`), agent authoring guidance, skill design, CLAUDE.md/AGENTS.md conventions for LogicSpec-using projects |
| `roadmap.md` | Phase 0 spec → Phase 1 core indexer (editor-independent) → Phase 2 VS Code extension → Phase 3 visualization → Phase 4 AI/MCP → Phase 5 generation |
| `open-questions.md` | ID namespacing model, nested workspaces, multi-root VS Code, external modules/imports, context/data typing depth, step-type extensibility |

The `docs/superpowers/specs/` directory holds process design docs (like this one) and is not part of the public spec set.

## 3. JSON Schema

`schema/logicspec-0.1.schema.json` — one schema, `oneOf` discriminated by `kind`. Validates envelope, body shapes, ID patterns (kebab/Pascal regexes), step-type fields. Documents (and example files) may carry:

```yaml
# yaml-language-server: $schema=../../schema/logicspec-0.1.schema.json
```

giving VS Code validation + completion today with the standard YAML extension, no LogicSpec extension needed. The schema is declarative specification, not executable code, so it stays within Phase 0 rules.

Schema cannot validate cross-document identity references (that is the future indexer's job); this limitation is stated in `discovery.md` and `references.md`.

## 4. Example workspace

`examples/salon-platform/` — deliberately distributed layout to prove location-independence:

```text
examples/salon-platform/
├── logicspec.yaml
├── domains/
│   ├── booking/
│   │   ├── booking.module.logic.yaml
│   │   └── features/
│   │       ├── create-booking.logic.yaml
│   │       └── cancel-booking.logic.yaml
│   ├── payment/
│   │   └── payment.module.logic.yaml
│   └── notification/
│       ├── notification.module.logic.yaml
│       └── notify-on-booking.logic.yaml     # wait-step consumer feature
├── backend/
│   ├── booking/booking-service.logic.yaml
│   └── payment/payment-service.logic.yaml
└── contracts/
    └── events.logic.yaml                     # PaymentRequested, PaymentCompleted, BookingCreated, BookingCancelled
```

The example demonstrates: module membership from scattered directories, `page/operation/decision/publish/wait/outcome` steps, cross-module event chain (`PaymentRequested → PaymentCompleted → BookingCreated → notification`), service operations with errors, and schema headers.

## 5. Repo-level agent instructions

- `CLAUDE.md` (repo root): project one-liner, current phase and its rules (docs-only, schema allowed, no indexer/extension code), doc map with one-line purpose per file, core conventions (IDs, identity-not-path references, never write derived state into `logicspec.yaml`), example-workspace pointer, style rules for spec prose (RFC-2119 keywords, one concept per doc).
- `AGENTS.md`: same substance, tool-neutral wording for Codex and other agents. Keep both in sync; CLAUDE.md may simply reference AGENTS.md content if drift risk is a concern — decision: duplicate the short content, both files are small.

## 6. Repo hygiene

- `.gitignore`: `node_modules/`, `dist/`, `build/`, `.DS_Store`.
- Leave the stray `node_modules/` on disk (untracked, harmless) — ignored going forward.
- README rewrite: keep the pitch, add workspace-model summary, doc map, example pointer, phase status.

## Error handling / quality gates (Phase 0 form)

With no code, "error handling" means specification precision:

- Every normative statement uses MUST/SHOULD/MAY deliberately.
- Every syntax construct shown in docs validates against the JSON Schema.
- Example workspace is internally consistent: every referenced module/operation/event/step exists; no orphan references.
- Diagnostics that future tooling must emit are enumerated in `references.md` and `vscode-extension.md` (unknown module, unknown step, duplicate ID, unknown operation, unreachable step).

## Testing (Phase 0 form)

Manual verification checklist executed before commit:

1. All example YAML parses (`yq`/python-yaml pass).
2. Example files validate against the JSON Schema (ajv or python-jsonschema one-shot check — a verification step, not shipped tooling).
3. Cross-reference audit of the example workspace (grep-level: every `call:`/`event:`/`module:` target defined).
4. Doc link check: relative links between docs resolve.

## Success criteria

- A newcomer can read `README.md` → `vision.md` → `specification.md` and author a valid feature file unaided.
- Claude Code/Codex, given only `CLAUDE.md`/`AGENTS.md`, can locate the right doc for any LogicSpec question and author schema-valid documents.
- The example workspace exercises every v0.1 construct at least once.
