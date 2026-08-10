# Roadmap

v0.1 delivered the complete `YAML → parse → validate → normalize → visualize` core. 0.5.0 implemented the next four planned milestones in one release. None of it changed the language's independence: the YAML DSL stays useful without any integration.

## Shipped in 0.5.0

Formerly the v0.2–v0.5 roadmap:

**Richer views and references** (was v0.2)

* Sequence-diagram view (`--view sequence`) — actor interaction map
* Event-model view (`--view event-model`) — Interface / Logic / Events / Outcomes lanes
* OpenAPI references on catalog operations (`openapi: { document, operationId }`, LS108/LS403)
* AsyncAPI references on catalog events (`asyncapi: { document, channel }`, LS109)
* Context data-flow analysis — produced-before-required on every path (LS203)
* Workspace dependency graph (`logicspec graph`) — features, subflows, event pub/wait
* Semantic feature diff (`logicspec diff`) — pulled forward from "Later"

**Editor experience** (was v0.3)

* VS Code extension (`integrations/vscode/`): inline diagnostics with exact ranges, live Mermaid preview, validate-workspace command. Runs validation in the extension host — a proper language server is a future refinement.
* Diagnostics carry end positions, so any editor can underline the exact range.

**Visual editing** (was v0.4)

* React Flow editor (`integrations/editor/`): two-way YAML ↔ visual editing over a comment-preserving document API, node palette for the nine step types, inspector. Ships without position persistence and without in-browser catalog checks.

**Agent integration** (was v0.5)

* MCP server (`logicspec mcp`): seven tools over dependency-free stdio JSON-RPC — `list_features`, `get_feature`, `get_step`, `get_transitions`, `get_service_dependencies`, `get_events`, `validate_feature`.
* `logicspec validate --json` and workspace-wide bare `validate` for CI and agents.
* Per-workspace severity overrides (`diagnostics:` in config).

## Later

* Language server behind the VS Code extension (shared with other editors)
* Deeper cross-feature analysis: context contracts across subflow boundaries
* Architecture visualization across features and services beyond the dependency graph
* Generated test skeletons from paths and outcomes
* Documentation generation beyond diagrams
* Pull-request validation bot
* CI policy checks (e.g. "every operation must handle an error outcome") — severity overrides are the first brick
* Marketplace/npm publication once the final public name is settled

## Non-goals

LogicSpec will not become a workflow engine, a programming language, or a replacement for OpenAPI/AsyncAPI. Execution, code generation of business logic, and runtime concerns stay out of scope.
