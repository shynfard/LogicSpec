# Discovery and the Workspace Index

Discovery is how tooling turns a directory tree into a workspace: locate the root manifest, find every LogicSpec document, and build the derived index that all other tooling consumes. This document specifies the semantics future tooling MUST implement (Phase 1 of the [roadmap](roadmap.md)).

## The discovery algorithm

Tooling MUST:

1. locate `logicspec.yaml` (the workspace root);
2. read the workspace configuration;
3. discover all documents matching `discovery.include` minus `discovery.exclude` (defaults per the [specification](specification.md#workspace-manifest));
4. parse each document's metadata;
5. identify the document kind;
6. identify the document ID;
7. identify module membership;
8. construct the workspace index;
9. resolve cross-document references;
10. report unresolved or duplicate identities as [diagnostics](references.md#diagnostics).

A document that fails YAML parsing or shape validation is itself a diagnostic; it MUST NOT abort discovery of the rest of the workspace.

## The workspace index

The index is the core abstraction of all LogicSpec tooling — the same index feeds the [VS Code extension](vscode-extension.md), the CLI, [MCP/AI agents](ai-integration.md), visualization, and future generators. Conceptually it contains:

```text
Workspace
Modules
Features
Services
Operations
Events
Context definitions
References
Source locations
Relationships
Diagnostics
```

Identifiers resolve independently of physical file paths — a conceptual symbol table:

```text
module:booking
feature:create-booking
feature:cancel-booking
service:booking-service
service:payment-service
event:BookingCreated
event:PaymentCompleted
```

### Source locations

Although references are identity-based, the index MUST retain source locations so tools can navigate to definitions:

```text
kind: module
id: booking
source:
  file: domains/booking/booking.module.logic.yaml
  line: 5
```

### The index is derived — always

The index MUST be generated dynamically. It MUST NOT be committed to the repository or written back into `logicspec.yaml` or any other document. See [workspaces.md](workspaces.md) for why.

```text
LogicSpec documents
        ↓
Workspace index
        ↓
IDE / CLI / AI / visualization
```

## Validation layers

| Layer | Checks | Checked by |
|-------|--------|-----------|
| Shape | one document's structure, ID patterns, step fields | [JSON Schema](../schema/logicspec-0.1.schema.json), today |
| Identity | cross-document references, uniqueness, reachability | workspace index (Phase 1) |

The schema cannot see across documents; an unresolved `call:` target is invisible to it. That is the indexer's job.

## Incremental indexing

Tooling SHOULD NOT rescan the entire workspace after every change:

```text
file changed
    ↓
parse changed document
    ↓
update symbol index
    ↓
resolve affected references
    ↓
update diagnostics
    ↓
update views (explorer, overviews, graph)
```

## File watching

Tooling SHOULD detect created, deleted, renamed, and modified `*.logic.yaml` files and update the index automatically. Renames are identity-neutral: a moved file keeps its IDs, so references stay intact and only source locations change.
