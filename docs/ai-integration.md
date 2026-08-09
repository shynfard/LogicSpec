# AI Integration

LogicSpec is AI-native: an application defined in LogicSpec is a structured knowledge graph that agents query instead of reverse-engineering intent from code. This document specifies how AI tooling consumes and authors LogicSpec — the MCP surface (Phase 4 of the [roadmap](roadmap.md)), authoring rules for agents, and conventions for projects that use LogicSpec with Claude Code, Codex, and similar tools.

## Why structured beats grep

Without LogicSpec tooling, an agent asked about booking behavior must grep YAML and source files and reassemble the picture. With the [workspace index](discovery.md), tooling answers directly:

```text
Give me module booking
```

```text
Module: Booking

Features:  create-booking, cancel-booking
Services:  booking-service
Publishes: BookingCreated, BookingCancelled, PaymentRequested
Consumes:  PaymentCompleted
```

The same index that powers the [VS Code extension](vscode-extension.md) powers agents. One abstraction, every consumer.

## MCP tool surface (Phase 4)

The LogicSpec MCP server exposes index queries as tools:

| Tool | Input | Output |
|------|-------|--------|
| `get_workspace` | — | workspace ID/name, module/feature/service/event counts, problem count |
| `list_modules` | — | all modules with summary stats |
| `get_module` | module ID | features, services, published/consumed events, dependencies |
| `list_features` | optional module ID | feature IDs + names |
| `get_feature` | feature ID | full feature: steps, transitions, operations called, events, outcomes |
| `get_service` | service ID | operations with inputs/outputs/errors/publishes |
| `get_operation` | `service.operation` | one operation definition + its callers |
| `get_event` | event name | definition, publishers, consumers |
| `find_references` | any ID | every location referencing it (file, line) |
| `get_dependencies` | module ID | modules it depends on and why (calls, events) |
| `validate_workspace` | — | all current [diagnostics](references.md#diagnostics) |

All tools are read-only views over the index. Mutation happens the same way humans do it: editing documents, which the indexer picks up [incrementally](discovery.md#incremental-indexing).

## Rules for agents authoring LogicSpec

Agents writing or editing LogicSpec documents MUST follow the [specification](specification.md). In particular:

1. Reference by **identity**, never file path (`module: booking`, `call: booking-service.reserve-slot`).
2. Use only the six v0.1 step types — the set is closed; do not invent step types or keys.
3. Validate every document against the [JSON Schema](../schema/logicspec-0.1.schema.json) before considering the edit done.
4. Never write derived state (module lists, counts, indexes) into `logicspec.yaml` or any document.
5. Respect [ID casing and uniqueness](references.md#uniqueness); check for collisions before introducing an ID.
6. After editing, verify cross-references resolve: every `call:` target exists, every `event:` is defined, every step target exists in the feature.

## Skill design (future)

A LogicSpec skill for Claude Code (and equivalents for other agents) packages the authoring workflow:

- **Triggers** — creating/editing `*.logic.yaml`, "add a feature/module/service", "what does module X do".
- **Workflow** — read `docs/specification.md` → author or edit the document → schema-validate → cross-reference check → report the derived view (what the module now contains).
- **With MCP available** — prefer index queries (`get_module`, `find_references`) over reading files; validate via `validate_workspace`.

The skill ships alongside the MCP server in Phase 4; until then, the conventions below cover the gap.

## Conventions for projects using LogicSpec

A project that defines its application in LogicSpec should tell its coding agents about it. Recommended snippet for the project's `CLAUDE.md` / `AGENTS.md`:

```markdown
## Application definition (LogicSpec)

This project's behavior is defined in LogicSpec documents (`logicspec.yaml`
root manifest + `**/*.logic.yaml`). Before implementing or changing a
feature, read its LogicSpec definition — it is the source of truth for
flows, services, and events. Keep code and definition in sync: when
behavior changes, update the `.logic.yaml` document in the same change.
Spec reference: https://github.com/shynfard/LogicSpec
```

## Agent parity

Claude Code reads `CLAUDE.md`; Codex and most other agents read `AGENTS.md`. This repository ships both with identical substance ([CLAUDE.md](../CLAUDE.md), [AGENTS.md](../AGENTS.md)) and recommends downstream projects do the same. Nothing in LogicSpec is agent-specific: the MCP surface, the schema, and the conventions work for any tool that speaks MCP and reads Markdown.
