# Workspaces

A LogicSpec project is not a collection of individual YAML files. It is a **workspace of distributed application-definition documents**: one root manifest plus every LogicSpec document discovered below it.

## The root manifest

Every workspace SHOULD have exactly one root manifest named `logicspec.yaml`:

```yaml
logicSpec: "0.1"

kind: workspace

workspace:
  id: salon-platform
  name: Salon Platform

discovery:
  include:
    - "**/*.logic.yaml"
  exclude:
    - "node_modules/**"
    - ".git/**"
    - "dist/**"
    - "build/**"
```

The manifest represents the workspace and configures [discovery](discovery.md). It does **not** enumerate the workspace's documents — those are found automatically.

## Distributed documents

LogicSpec documents may exist anywhere below the workspace root:

```text
project/
├── logicspec.yaml
├── domains/
│   └── booking/
│       ├── booking.module.logic.yaml
│       └── features/
│           └── create-booking.logic.yaml
├── backend/
│   └── booking/
│       └── booking-service.logic.yaml
└── contracts/
    └── events.logic.yaml
```

Physical directory structure MUST NOT determine semantic identity. Logical identity comes from LogicSpec identifiers. The [salon-platform example](../examples/salon-platform/) deliberately scatters one module's documents across `domains/`, `backend/`, and `contracts/` to demonstrate this.

### Moving a file must not change the architecture

Because references resolve against [identity, not paths](references.md), this file:

```text
modules/booking/booking.module.logic.yaml
```

can move to:

```text
domains/customer-facing/booking/booking.module.logic.yaml
```

and remain the same `module: booking`. Nothing else in the workspace changes. Refactoring directories never breaks semantic references.

## The root manifest is configuration, not generated state

This distinction is fundamental:

```text
logicspec.yaml
       │
       │ configuration
       ▼
Discovery Engine
       │
       ▼
All *.logic.yaml
       │
       ▼
Workspace Index
       │
       ├── Explorer
       ├── Navigation
       ├── Diagnostics
       ├── Graph
       ├── AI
       └── future generators
```

Tooling MUST NOT write derived information back into the manifest. Do **not** mutate it into:

```yaml
modules:
  - booking
  - payment
```

when these are discoverable. Derived indexes in committed files create duplicated state, unnecessary Git diffs, synchronization problems, merge conflicts, and stale metadata. The workspace overview a tool presents (module counts, feature lists) is a [generated view over the index](vscode-extension.md#root-workspace-overview), never file content.

## Workspace boundaries

- **One manifest per workspace.** A workspace MUST NOT contain more than one workspace document.
- **Nested workspaces** — a workspace SHOULD NOT contain another independent workspace unless tooling explicitly supports nested boundaries. Open question; see [open-questions.md](open-questions.md).
- **Multi-root editors** — initial tooling supports one `logicspec.yaml` per editor workspace folder; multi-root support is an implementation-stage decision. See [open-questions.md](open-questions.md).
- **External modules** — importing modules from outside the workspace (git sources, packaged libraries) is future work with no v0.1 syntax. See [open-questions.md](open-questions.md).
