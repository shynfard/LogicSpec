# Vision

LogicSpec is an open-source, AI-native Application Definition Language. It describes how software should behave — flows, rules, services, events, errors, outcomes — without tying that behavior to a programming language, framework, or implementation.

## The thesis

> **The application specification becomes the source. Code becomes a generated implementation artifact.**

Today, source code is the only durable description of what an application does. Requirements documents rot, diagrams drift, and the truth lives scattered across thousands of files in implementation-specific form. AI coding agents inherit this problem: to understand an application, they must reverse-engineer intent from code.

LogicSpec inverts this. Application behavior is defined declaratively in YAML documents that are:

- **validated** — structurally by the [JSON Schema](../schema/logicspec-0.1.schema.json) today, semantically by the workspace indexer (Phase 1);
- **visualized** — flow diagrams, module graphs, and workspace overviews derived automatically (Phase 3);
- **understood by AI** — a structured application knowledge graph queryable by agents instead of grep-archaeology (Phase 4);
- **used for generation** — the structured input from which agents and generators produce implementations (Phase 5).

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

## What LogicSpec is not

- **Not a programming language replacement.** LogicSpec defines *what* the application does; agents, generators, frameworks, and developers decide *how*.
- **Not a modeling notation for diagrams' sake.** Every construct exists to be validated, indexed, queried, and eventually executed against.
- **Not a code annotation format.** LogicSpec documents are primary artifacts, not comments on an implementation.

## AI-native by design

An application defined in LogicSpec is a knowledge graph: modules, features, steps, services, operations, and events, connected by identity-based references. Instead of forcing an AI agent to grep arbitrary files, future tooling answers structural questions directly:

```text
Give me module booking
```

```text
Module: Booking

Features:  create-booking, cancel-booking
Services:  booking-service
Publishes: BookingCreated, BookingCancelled
Consumes:  PaymentCompleted
```

This is why the [workspace model](workspaces.md) insists on identity over file paths, why the root manifest stays free of derived state, and why the [workspace index](discovery.md) is a core abstraction: the same index that powers the [VS Code experience](vscode-extension.md) powers [AI agents over MCP](ai-integration.md).

## Where this goes

See [roadmap.md](roadmap.md) for the phased plan: specification (now) → core indexer → VS Code extension → visualization → AI/MCP → generation.
