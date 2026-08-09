# Roadmap

LogicSpec is built specification-first: the language and workspace model are designed for the tooling before the tooling exists. Each phase builds on the previous one; the [workspace index](discovery.md) introduced in Phase 1 is the foundation everything else consumes.

```text
                         logicspec.yaml
                       WORKSPACE MANIFEST
                              │
                              ▼
                         DISCOVERY
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
     booking.logic      payment.logic      services.logic
           │                  │                  │
           └──────────────────┼──────────────────┘
                              ▼
                       WORKSPACE INDEX
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
         VS Code             CLI             MCP
             │                                 │
             ▼                                 ▼
       Visual Overview                    AI Agents
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                     future generators
```

## Phase 0 — Specification *(current)*

Documentation only. No executable code; the [JSON Schema](../schema/logicspec-0.1.schema.json) is the only machine-readable artifact.

Deliverables: [core DSL v0.1](specification.md), [workspace model](workspaces.md), [modules](modules.md), [discovery semantics](discovery.md), [references and diagnostics](references.md), [VS Code extension design](vscode-extension.md), [AI integration design](ai-integration.md), JSON Schema, the [salon-platform example](../examples/salon-platform/), and agent instructions (CLAUDE.md / AGENTS.md).

**Done when:** a newcomer can author a valid feature file from the docs alone, and every example document validates against the schema with zero unresolved references.

## Phase 1 — Core Indexer

The editor-independent engine:

- YAML parsing with source locations
- workspace discovery per [discovery.md](discovery.md)
- document parsing for all five kinds
- symbol index (IDs → definitions)
- reference resolver
- [diagnostics](references.md#diagnostics)
- graph model (modules, event flows, dependencies)

**Constraint:** the indexer MUST be editor-independent — a library consumed by the CLI, the VS Code extension, and the MCP server alike.

## Phase 2 — VS Code Extension

Per [vscode-extension.md](vscode-extension.md): LogicSpec Explorer, automatic workspace discovery, module/feature navigation, Go to Definition, Find References, diagnostics, document outline, root workspace overview.

## Phase 3 — Visualization

- feature flow diagrams
- module dependency graph
- workspace architecture graph
- Mermaid export

## Phase 4 — AI / MCP

The MCP server exposing index queries (`get_workspace`, `get_module`, `find_references`, `validate_workspace`, …) plus the agent authoring skill. Full surface in [ai-integration.md](ai-integration.md).

## Phase 5 — Generation

The indexed application definition becomes structured input for AI/software generation: backends, frontends, and tests derived from the specification. This is the end-state of the [vision](vision.md) — code as generated implementation artifact.
