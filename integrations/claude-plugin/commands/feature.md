---
description: Design a new LogicSpec feature spec from a description, validate it, and render it
argument-hint: <feature description, e.g. "checkout with payment retry and cancellation">
---

Create a new LogicSpec feature specification for: $ARGUMENTS

Follow the logicspec-authoring skill. Steps:

1. If no `logicspec.config.yaml` exists upward from here, run `logicspec init`
   first (or ask where the workspace should live if the layout is ambiguous).
2. Sketch the flow before writing YAML: pages the user moves through, the
   backend operations (each one a step with `call:`), decisions, events,
   error paths with recovery actions, and the final outcomes (include a
   failure or cancelled ending where honest).
3. Write `features/<id>.feature.yaml` using the nine step types. Declare
   every actor and context variable you reference; put `produces` on the
   action/operation that creates each value so every `requires` is satisfied
   on every path. Reach for the full vocabulary where it fits: a
   `decisionTable` for rule grids, typed events (`eventKind`), `boundary`
   handlers for mid-flight timeouts/errors on page/subflow/parallel, `zones`
   for AI-agent regions, `$ref` for shared definitions.
4. Add any missing operations to `services.yaml` and events to `events.yaml`
   (and shared actors/step templates to `definitions.yaml` if configured).
5. Run `logicspec validate <file>` and fix every finding by its LS code
   (see the skill's diagnostics reference). Repeat until exit code 0
   (1 = validation findings; 2 = parse/config/usage error — fix by hand).
6. Run `logicspec render <file>` and show the user the generated Mermaid
   plus a one-paragraph summary of the flow and its outcomes.
