# LogicSpec Specification (DSL version 1)

This document defines the LogicSpec language: a YAML DSL for describing application feature logic. It is the normative reference for authors, tool builders, and validator behavior.

LogicSpec is a **specification language**, not an execution language. Nothing in a LogicSpec document is ever executed. Expressions, conditions, and durations are descriptive data.

## Goals

1. Describe feature behavior — screens, actions, decisions, backend operations, events, waits, error paths, outcomes — in one small, human-writable format.
2. Be trivially machine-readable: for validators, renderers, CI, and AI coding agents.
3. Stay deterministic: the same document always produces the same normalized model and the same rendered output.
4. Remain a closed vocabulary: nine step types, one preferred syntax per concept.

## Terminology

| Term | Meaning |
|------|---------|
| **Feature** | One user-facing capability, described by one `*.feature.yaml` document |
| **Step** | A named node in the feature's flow; one of nine types |
| **Transition** | A directed edge from one step to another |
| **Actor** | A participant responsible for steps (user, frontend, service, …) |
| **Context** | Named data values that flow through the feature |
| **Catalog** | A workspace-level registry of services/operations or events |
| **Workspace** | A directory tree governed by one `logicspec.config.yaml` |
| **Terminal** | A step where the flow ends: any `final` step, or an `error` step without actions |

## Identifiers

Step ids, actor ids, action ids, context variable names, service ids, operation ids, and event names are identifiers:

* must start with a letter (`A–Z`, `a–z`);
* may contain letters, digits, `-` and `_`.

Convention (not enforced): kebab-case for steps/actors/actions/services/operations (`reserve-slot`), camelCase for context variables (`reservationId`), PascalCase for event names (`BookingCreated`).

## Document structure

Every feature document has this top-level shape:

```yaml
version: "1"          # required — DSL version, always the string "1"

feature:              # required
  id: booking         # required — identifier
  name: Booking       # required — display name
  description: …      # optional

start: select-service # required — id of the first step

actors: { … }         # optional — map of actor id → actor
context: { … }        # optional — map of variable name → context variable
steps: { … }          # required — map of step id → step

extensions: { … }     # optional — namespaced extension data
```

Unknown properties are rejected everywhere. All objects are strict; this catches typos early. The only open escape hatch is `extensions` (see below).

### Versioning policy

`version: "1"` is required in every document (feature files, catalogs, config). The semantics of version 1 will never change silently. Breaking changes to the language require `version: "2"`; tools may then support both.

## Actors

```yaml
actors:
  customer:
    kind: user        # required
    label: Customer   # optional — defaults to the actor id
    description: …    # optional
```

`kind` is one of:

```text
user  frontend  service  broker  external  system
```

A step may declare `actor: <actor-id>`. The actor must exist. Actors drive the swimlane view and responsibility documentation.

## Context

```yaml
context:
  reservationId:
    type: string      # required
    description: …    # optional
```

`type` is one of:

```text
string  number  boolean  object  array  date  datetime
```

Context is **descriptive**. It is not a type system and is never evaluated. Steps reference context variables via `requires:` and `produces:`; every referenced name must be declared.

## Steps

All steps share these optional properties (only `type` is required):

```yaml
type:         # required — one of the nine step types
label:        # display label, defaults to the step id
actor:        # responsible actor id
description:  # free text
tags:         # list of strings
notes:        # free text
extensions:   # namespaced extension data
```

Transition targets always use the form `next: <step-id>`. Where a step has named outcomes, each outcome is an object:

```yaml
on:
  success:
    next: checkout        # required
    label: Paid           # optional — overrides the edge label
```

The nine step types are a **closed set**. Tools must reject unknown types. Per-type details and examples live in [step-types.md](step-types.md); the normative property lists follow.

### `page`

A frontend screen or meaningful UI state.

| Property | Notes |
|----------|-------|
| `route` | optional string, e.g. `/booking/checkout` |
| `requires` | optional list of context names needed before entering |
| `states` | optional list of **local UI states** (`loading`, `ready`, `empty`, `error`, …) |
| `load` | optional list of background data loads (below) |
| `actions` | optional map of action id → action |

An action:

```yaml
actions:
  select:
    label: Select slot    # optional, defaults to the action id
    requires: [ … ]       # optional context names
    produces: [ … ]       # optional context names
    next: reserve-slot    # required
```

A load entry:

```yaml
load:
  - call: booking.get-availability   # required — service operation reference
    on:                              # optional — outcome → LOCAL page state
      success: ready
      empty: empty
      error: error
```

`load.on` targets are page **states**, not workflow steps. If the page declares `states`, every `load.on` target must be one of them. Default renderers do not create workflow nodes for loads.

A page with no actions is a dead end (LS201) unless the flow is meant to end there — in which case it should transition to a `final` step instead.

### `decision`

Branching logic. Conditions are opaque strings; validators never evaluate them.

| Property | Notes |
|----------|-------|
| `expression` | optional descriptive expression |
| `cases` | optional list of `{ label?, when?, next }` |
| `default` | optional `{ label?, next }` |

At least one case or a default is required (LS303).

### `operation`

Meaningful backend/system work.

| Property | Notes |
|----------|-------|
| `call` | optional `<service>.<operation>` reference |
| `requires` / `produces` | optional context names |
| `next` | shorthand for a single unnamed outcome |
| `on` | map of outcome name → `{ label?, next }` |

`next` and `on` are **mutually exclusive** (LS301). An operation with neither is a dead end (LS201).

### `event`

Publish a domain event, or wait for one.

| Property | Notes |
|----------|-------|
| `direction` | required: `publish` or `wait` |
| `event` | required event name, resolved against the event catalog |
| `next` | `publish` only |
| `on` | `wait` only: `{ received: { label?, next }, timeout?: { label?, next } }` |
| `timeout` | optional duration; how long to wait before the timeout outcome |

Direction rules are enforced (LS302): publishing events must not declare `on`/`timeout`; waiting events must declare `on.received` and must not declare `next`.

### `wait`

An intentional time delay.

| Property | Notes |
|----------|-------|
| `duration` | required duration |
| `next` | required target |

### `subflow`

Invokes another feature.

| Property | Notes |
|----------|-------|
| `flow` | required — the other feature's id (or its file stem) |
| `requires` / `produces` | optional context names |
| `next` / `on` | mutually exclusive, same rules as `operation` |

Subflows resolve against `*.feature.yaml` files in the workspace's features directory. Resolution is validated when workspace information is available (LS106).

### `parallel`

Runs independent subflows concurrently. Branches reference subflows only — there is no inline branching language.

| Property | Notes |
|----------|-------|
| `branches` | required map of branch id → `{ flow: <feature-id> }`; at least one (LS304) |
| `wait` | optional join strategy: `all` (default) or `any` |
| `next` | required target after the join |

### `error`

A failure state.

| Property | Notes |
|----------|-------|
| `message` | optional user-facing message |
| `actions` | optional map of action id → `{ label?, next }` |

An error **without actions is terminal** — the flow ends there in failure.

### `final`

A terminal outcome.

| Property | Notes |
|----------|-------|
| `outcome` | required: `success`, `failure`, or `cancelled` |

A final step must not have outgoing transitions; `next` or `on` on a final step is rejected (LS300).

## Transitions and edge kinds

Every transition in the document normalizes to an edge `{ from, to, kind, label? }` with one of these kinds:

| Kind | Source |
|------|--------|
| `action` | page action, error recovery action |
| `outcome` | `on:` outcome of an operation or subflow |
| `decision` | a decision case |
| `default` | a decision default |
| `event` | `on.received` / `on.timeout` of a waiting event |
| `next` | plain `next` (operation shorthand, publish, wait, parallel) |

Edge labels come from the author's `label`, falling back to the action id, outcome name, `when` expression, or (for `wait`) `after <duration>`.

## Durations

Durations are human-readable strings: one or more `<number><unit>` segments, optionally space-separated. Units: `ms`, `s`, `m`, `h`, `d`, `w`.

```yaml
timeout: 15m
duration: 1h 30m
```

Tools validate the format only; durations are never interpreted at runtime.

## Extensions

Organizations can attach custom data anywhere `extensions` is allowed (document, feature, steps, catalog entries):

```yaml
extensions:
  company.example/foo:
    anything: true
```

Keys must be namespaced — they must contain a `/`. Core validation preserves and ignores extension data. Unknown properties *outside* `extensions` remain errors: the escape hatch is explicit, never implicit.

## Service catalog (`services.yaml`)

```yaml
version: "1"

services:
  booking:
    name: Booking Service        # optional
    description: …               # optional
    operations:
      reserve-slot:
        kind: http
        method: POST
        path: /reservations
```

Operation kinds and their properties:

| Kind | Properties |
|------|-----------|
| `http` | `method` (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), `path` |
| `grpc` | `service`, `method` |
| `internal` | `operation` (optional) |
| `command` | `command` (optional) |
| `other` | `protocol` (optional) |

All kinds accept `description` and `extensions`. Feature files reference operations as `call: booking.reserve-slot`; when a catalog is configured, both the service and the operation must exist (LS104). LogicSpec catalogs do not replace OpenAPI or AsyncAPI; later versions may reference them.

## Event catalog (`events.yaml`)

```yaml
version: "1"

events:
  BookingCreated:
    topic: booking.created       # optional
    producer: booking            # optional
    consumers: [notification]    # optional
    description: …               # optional
    payload:
      schema: ./schemas/booking-created.json   # optional
```

Feature files reference events by name (`event: BookingCreated`); when a catalog is configured, the name must exist (LS105).

## Workspace configuration (`logicspec.config.yaml`)

```yaml
version: "1"

features:
  directory: ./features    # default

catalogs:
  services: ./services.yaml
  events: ./events.yaml

output:
  directory: ./generated   # default

render:
  view: flow               # flow | swimlane, default flow
  direction: TD            # TD | TB | LR | RL | BT, default TD
```

Tools locate the config by walking up from the file being processed. All config paths resolve relative to the config file's directory. CLI flags override configuration. Without a config file, defaults apply and catalog/subflow validation is skipped.

## Renderer behavior

Renderers consume the normalized model, never raw YAML, and must be deterministic: nodes and edges appear in source order, and the same document always produces byte-identical output.

The flowchart renderer:

* emits a `START` circle plus one node per step;
* encodes step type as **shape** and as a text marker in the label (`Reserve Slot` / `OPERATION`), so meaning survives light/dark themes, print, and monochrome;
* shapes: page → rectangle, decision → diamond, operation and subflow → subroutine, event → flag, wait → stadium, parallel → parallelogram, error → marked rectangle, final → double circle (label includes `FINAL · <outcome>`);
* renders waiting-event edges dotted, all others solid;
* escapes all user text with Mermaid entity codes (`#quot;`, `#lt;`, `#gt;`, `#amp;`, `#35;`) — a label can never break diagram syntax;
* keeps internal node ids independent from display labels.

The swimlane renderer (experimental) groups steps into per-actor subgraphs, lanes ordered by actor declaration.

Generated Markdown always carries a **GENERATED FILE — DO NOT EDIT** warning naming the source file. The YAML is authoritative; diagrams are documentation.

## What LogicSpec is not

* Not a workflow engine: nothing executes, waits, or retries at runtime.
* Not a programming language: no scripts, no evaluated expressions (`expression`, `when`, `notes`, labels are data).
* Not an API description language: catalogs identify operations and events; OpenAPI/AsyncAPI describe their contracts.

## Extension strategy

The language grows by need, not speculation:

1. Custom data → namespaced `extensions`.
2. New semantics with a sound design → a proposal issue, then possibly a new minor capability within version 1 (additive, non-breaking).
3. Anything that changes existing meaning → DSL `version: "2"`.
