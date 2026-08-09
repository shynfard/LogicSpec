# LogicSpec

**Define the logic. Generate the software.**

LogicSpec is an open-source, AI-native Application Definition Language for describing how software should behave without tying that behavior to a specific programming language, framework, or implementation.

> **Status: Phase 0 — Specification.** The language and workspace model are being designed documentation-first. No tooling exists yet; see the [roadmap](docs/roadmap.md).

Instead of treating source code as the only source of truth, LogicSpec lets you describe application behavior declaratively in YAML:

* pages and application states
* user actions
* decisions and business rules
* backend operations
* services and APIs
* Pub/Sub events
* asynchronous workflows
* errors and recovery paths
* feature outcomes

A LogicSpec definition can be validated, visualized automatically, understood by AI coding agents, and used as the source for generating software.

```text
                    LogicSpec
              Application Definition
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
      Validate      Visualize      AI Agent
                        │             │
                     Mermaid          │
                                      ▼
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                      Backend      Frontend       Tests
```

## A taste

```yaml
logicSpec: "0.1"

kind: feature

module: booking

feature:
  id: create-booking
  name: Create Booking
  start: select-service
  steps:
    select-service:
      type: page
      actions:
        next: reserve-slot
        cancel: cancelled
    reserve-slot:
      type: operation
      call: booking-service.reserve-slot
      on-success: confirm
      on-error:
        slot-conflict: conflict-error
    confirm:
      type: publish
      event: BookingCreated
      next: success
    success:
      type: outcome
      result: success
    cancelled:
      type: outcome
      result: cancelled
    conflict-error:
      type: outcome
      result: failure
```

## The workspace model

A LogicSpec project is a **workspace of distributed documents**: one root manifest (`logicspec.yaml`) plus `*.logic.yaml` documents anywhere below it, found by automatic [discovery](docs/discovery.md). Identity comes from IDs, never file paths — moving a file never changes the architecture. See [workspaces.md](docs/workspaces.md).

The [salon-platform example](examples/salon-platform/) shows a complete workspace: three modules, four features, three services, and a cross-module event chain, deliberately scattered across `domains/`, `backend/`, and `contracts/`.

Documents validate today against the [JSON Schema](schema/logicspec-0.1.schema.json) — add `# yaml-language-server: $schema=...` and VS Code's YAML extension checks your files as you type.

## Documentation

| Doc | What it covers |
|-----|----------------|
| [Vision](docs/vision.md) | Why LogicSpec exists; spec-as-source |
| [Specification](docs/specification.md) | **Normative** core DSL v0.1 |
| [Terminology](docs/terminology.md) | Glossary |
| [Workspaces](docs/workspaces.md) | Root manifest, distributed documents |
| [Modules](docs/modules.md) | Logical areas and membership |
| [Discovery](docs/discovery.md) | Document discovery and the workspace index |
| [References](docs/references.md) | Identity-based references and diagnostics |
| [VS Code Extension](docs/vscode-extension.md) | Future editor experience (design) |
| [AI Integration](docs/ai-integration.md) | MCP tools, agent authoring rules |
| [Roadmap](docs/roadmap.md) | Phases 0–5 |
| [Open Questions](docs/open-questions.md) | Deliberately unresolved decisions |

## Roadmap at a glance

**0 Specification** (now) → **1 Core Indexer** → **2 VS Code Extension** → **3 Visualization** → **4 AI / MCP** → **5 Generation**

## The long-term vision

> **The application specification becomes the source. Code becomes a generated implementation artifact.**

LogicSpec is not intended to replace programming languages. It defines **what the application should do**, while AI agents, generators, frameworks, and developers determine **how it is implemented**.

## Contributing

Phase 0 is about getting the language right. Spec discussion happens in issues; unresolved design topics live in [open-questions.md](docs/open-questions.md).
