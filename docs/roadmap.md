# Roadmap

v0.1 is a complete `YAML → parse → validate → normalize → visualize` tool. Everything below builds on it — and none of it changes the language's independence: the YAML DSL stays useful without any of these integrations.

## v0.2 — richer views and references

* Sequence-diagram renderer (actor interactions over time)
* Event-modeling renderer
* OpenAPI references from service catalog operations
* AsyncAPI references from event catalog entries
* Deeper context/data-flow analysis (produced-before-required checking across paths)
* Multi-feature dependency graph (subflow and event relationships across a workspace)

## v0.3 — editor experience

* VS Code extension
* Click a diagnostic → jump to the YAML location
* Built-in live preview (no manual `watch` + Markdown preview split)

## v0.4 — visual editing

* React Flow-based visual editor
* Two-way YAML ↔ visual editing
* Node palette for the nine step types

## v0.5 — agent integration

* MCP server exposing the workspace to AI agents:
  * `list_features`
  * `get_feature`
  * `get_step`
  * `get_transitions`
  * `get_service_dependencies`
  * `get_events`
  * `validate_feature`

`logicspec inspect --json` already provides the stable model these tools will serve.

## Later

* Feature comparison (diff two versions of a flow semantically)
* Architecture visualization across features and services
* Generated test skeletons from paths and outcomes
* Documentation generation beyond diagrams
* Pull-request validation bot
* CI policy checks (e.g. "every operation must handle an error outcome")

## Non-goals

LogicSpec will not become a workflow engine, a programming language, or a replacement for OpenAPI/AsyncAPI. Execution, code generation of business logic, and runtime concerns stay out of scope.
