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
| **Catalog** | A workspace-level registry of services/operations, events, or shared definitions |
| **Workspace** | A directory tree governed by one `logicspec.config.yaml` |
| **Terminal** | A step where the flow ends: any `final` step, or an `error` step without actions |
| **Boundary event** | A documented mid-flight handler (`boundary`) on a `page`, `subflow`, or `parallel` step |
| **Zone** | A descriptive region of steps driven by an autonomous AI agent (`zones`) |
| **Shared definition** | A named actor or step template in `definitions.yaml`, pulled into features via `$ref` |

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
zones: [ … ]          # optional — list of agent zones (see below)

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
user  frontend  service  broker  external  system  agent
```

`agent` marks an autonomous AI agent actor; it behaves like any other kind and pairs naturally with [agent zones](#agent-zones). A step may declare `actor: <actor-id>`. The actor must exist. Actors drive the swimlane view and responsibility documentation.

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

## Agent zones

An optional top-level `zones` array demarcates regions of the flow as autonomous AI-agent territory — a stretch that is agent-driven and **order-not-fixed**, inside an otherwise deterministic spec.

```yaml
zones:
  - label: AI Triage        # required — display label
    description: …          # optional — prose
    kind: agent             # optional — only "agent" today (the default)
    steps:                  # required — member step ids
      - classify
      - enrich
      - draft-summary
```

A zone is **descriptive**: it is an annotation, not a control-flow construct. It does not execute, does not reorder, and produces no edges — it only records which steps sit inside the agent's autonomous region. Every `steps` id must resolve to a declared step, and a step belongs to **at most one** zone (LS309). Zones render as labelled subgraph clusters in the flowchart and are exposed on the model, the graph, the inspect report and the MCP tools. See [step-types.md](step-types.md#agent-zones) for details, rendering and bounds.

## Steps

All steps share these optional properties (only `type` is required):

```yaml
type:         # required — one of the nine step types
label:        # display label, defaults to the step id
actor:        # responsible actor id
description:  # free text
tags:         # list of strings
notes:        # free text
boundary:     # boundary event handlers — page, subflow and parallel steps only (below)
extensions:   # namespaced extension data
```

`boundary` is accepted by the schema on every step type but is only *valid* on `page`, `subflow`, and `parallel` steps; its normative rules are specified in [Boundary events](#boundary-events-boundary) after the step types.

Transition targets always use the form `next: <step-id>`. Where a step has named outcomes, each outcome is an object:

```yaml
on:
  success:
    next: checkout        # required
    label: Paid           # optional — overrides the edge label
    when: amount > 0      # optional — descriptive guard, never evaluated
```

An operation or subflow outcome — and a page action — may carry an optional `when` **guard**: a descriptive predicate documenting the condition under which that transition applies. Like every expression in the language, a guard is opaque data and is never evaluated. Renderers append it to the edge label as `[when: …]`. A guard that is present but blank is rejected (LS306).

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
    when: slot available  # optional — descriptive guard, never evaluated
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
| `decisionTable` | optional DMN-style decision table (below); mutually exclusive with `cases` (LS307) |
| `default` | optional `{ label?, next }` |

At least one case, a decision table, or a default is required (LS303).

A **decision table** expresses the branching as a grid of rules instead of free-form cases:

```yaml
route-order:
  type: decision
  label: Route Order
  decisionTable:
    inputs: [tier, total]          # input column headers — the things being tested
    outputs: [priority, next]      # output column headers — at least one
    hitPolicy: first               # optional — DMN hit-policy label, default "unique"
    rules:
      - when: ["gold", "-"]        # one predicate cell per input; "-" or "" means any
        then: ["high", "expedite"] # one value cell per output
      - when: ["-", "> 500"]
        then: ["high", "expedite"]
      - when: ["-", "-"]
        then: ["normal", "standard"]
```

The output column named **`next`** is reserved: each rule's cell in that column is the step id the decision transitions to when that rule is picked, so table targets flow through the same reference and reachability checks as any other edge. Every other output column is a descriptive result value, never interpreted. At most one `next` column is allowed; a table without one must declare a `default` (LS307), and a rule's `next` cell must not be blank or `-`. `hitPolicy` is one of `unique`, `first`, `priority`, `any`, `collect`, `ruleOrder`, `outputOrder` — a declarative label describing how matching rules combine; like every cell in the table, it is never evaluated. Rule widths must match the declared columns, and tables are bounded (1000 rules, 50 input/output columns, 500 characters per header or cell — LS307). In diagrams a table-driven decision keeps the diamond shape with a `DECISION TABLE · <POLICY> · <N> rules` marker, and each rule becomes one labeled edge (from its descriptive output cells, e.g. `priority: high`, or `rule N`).

### `operation`

Meaningful backend/system work.

| Property | Notes |
|----------|-------|
| `call` | optional `<service>.<operation>` reference |
| `requires` / `produces` | optional context names |
| `next` | shorthand for a single unnamed outcome |
| `on` | map of outcome name → `{ label?, when?, next }` (`when` is a descriptive guard) |

`next` and `on` are **mutually exclusive** (LS301). An operation with neither is a dead end (LS201).

### `event`

Publish a domain event, or wait for one. An event may optionally be **typed** with an `eventKind`, mirroring the common BPMN event kinds; the kind determines which descriptive fields are required.

| Property | Notes |
|----------|-------|
| `direction` | required: `publish` or `wait` |
| `eventKind` | optional classification: `timer`, `message`, `signal`, `error`, or `conditional` |
| `event` | event name, resolved against the event catalog. **Required** (non-blank) for generic events (no `eventKind`) and for `message`/`signal` events; **forbidden** on `timer`/`error`/`conditional` events (LS305) |
| `after` / `at` / `every` | `timer` only — exactly one required: a relative delay, an absolute date/time, or a recurring cadence (`after`/`every` use the duration format) |
| `name` | `error` only — optional error name/code |
| `when` | `conditional` only — required descriptive predicate |
| `next` | `publish` only |
| `on` | `wait` only: `{ received: { label?, next }, timeout?: { label?, next } }` |
| `timeout` | optional duration; how long to wait before the timeout outcome |

Direction rules are enforced (LS302): publishing events must not declare `on`/`timeout`; waiting events must declare `on.received` and must not declare `next`. Per-kind field consistency is enforced by LS305, which also requires `timer` and `conditional` events to use `direction: wait` — they are caught, never published. Every typed-event field is descriptive: no timer is ever scheduled and no predicate is ever evaluated. A typed event renders with an `EVENT · <KIND>` marker.

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
| `terminate` | optional boolean, default `false`; `true` ends the **whole flow instance**, not just this path |

A final step must not have outgoing transitions; `next` or `on` on a final step is rejected (LS300).

`terminate: true` marks a terminate end: reaching it stops the entire instance, including any parallel paths still described as in flight. The classification is derived, never stored: a terminated final renders a `⦻ TERMINATE` marker, a non-terminated `failure` outcome renders `⊗ ERROR`, and every other final is a normal terminal.

### Boundary events (`boundary`)

Any `page`, `subflow`, or `parallel` step may declare a `boundary` array: documented alternative paths taken when the step times out, errors, or receives a message/signal or condition **while it is still in progress**. Boundary handlers attach only to these three step types — the ones that cannot otherwise express mid-flight handling. On every other step type they are rejected (LS308): operation and waiting-event steps already carry outcome maps (`on:`, `on.timeout`), and a second way to say the same thing is not wanted.

| Property | Notes |
|----------|-------|
| `eventKind` | required trigger classification: `timer`, `message`, `signal`, `error`, or `conditional` |
| `interrupting` | optional boolean, default `true`: firing diverts the flow to `next`; `false` documents a parallel path instead |
| `after` / `at` / `every` | `timer` only — exactly one required (`after`/`every` use the duration format) |
| `event` | `message`/`signal` only — required event name, resolved against the event catalog (LS105) |
| `name` | `error` only — optional error name/code |
| `when` | `conditional` only — required descriptive predicate |
| `label` | optional display label, appended to the boundary edge |
| `next` | required target step id |

Per-kind field consistency mirrors the typed-event rules: the required field for the kind must be present and non-blank, and fields belonging to another kind are forbidden — enforced as LS308. A step is capped at 1000 handlers and each descriptive field at 500 characters (LS308).

```yaml
fulfil:
  type: subflow
  label: Fulfil Order
  flow: warehouse-fulfilment
  boundary:
    - eventKind: timer
      after: 2d
      label: SLA breached
      next: fulfilment-delayed
    - eventKind: error
      name: OutOfStock
      next: backorder
  on:
    shipped:
      next: notify
```

Like everything else in the language, a boundary handler is **descriptive**: the tool never fires a timer, matches a message, or evaluates a condition. Each handler normalizes to one `boundary` edge to its `next` target — subject to the same reference and reachability checks as every other transition — labeled with a trigger marker such as `⏱ after 2d`, `⚠ on-error OutOfStock`, `✉ on-message PriceChanged`, or `? when cart is abandoned`; a non-interrupting handler's label is suffixed `(non-interrupting)`.

## Transitions and edge kinds

Every transition in the document normalizes to an edge `{ from, to, kind, label?, guard? }` with one of these kinds:

| Kind | Source |
|------|--------|
| `action` | page action, error recovery action |
| `outcome` | `on:` outcome of an operation or subflow |
| `decision` | a decision case, or a decision-table rule (via the reserved `next` output column) |
| `default` | a decision default |
| `event` | `on.received` / `on.timeout` of a waiting event |
| `next` | plain `next` (operation shorthand, publish, wait, parallel) |
| `boundary` | a boundary event handler on a page, subflow, or parallel step |

Edge labels come from the author's `label`, falling back to the action id, outcome name, `when` expression, a decision-table rule's descriptive output cells (or `rule N`), or (for `wait`) `after <duration>`; a boundary edge is labeled with its trigger marker. The optional `guard` carries the `when` guard of a page action or an operation/subflow outcome and renders as a `[when: …]` suffix on the edge label.

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

All kinds accept `description`, `extensions`, and an optional `openapi` reference:

```yaml
      reserve-slot:
        kind: http
        method: POST
        path: /reservations
        openapi:
          document: ./openapi.yaml   # resolved relative to this catalog file
          operationId: reserveSlot
```

When present, the `operationId` must exist in the referenced document (LS108). For `kind: http`, the declared `method` and `path` are additionally cross-checked against the document's operation (LS403, warning). Documents are read as plain YAML/JSON; `$ref` indirection is not resolved.

Feature files reference operations as `call: booking.reserve-slot`; when a catalog is configured, both the service and the operation must exist (LS104). LogicSpec catalogs do not replace OpenAPI or AsyncAPI — they identify operations and, optionally, point at the contract that describes them.

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

Events may carry an optional `asyncapi` reference:

```yaml
    asyncapi:
      document: ./asyncapi.yaml    # resolved relative to this catalog file
      channel: booking.created     # channel key, or an AsyncAPI 3 address
```

When present, the channel must exist in the referenced document (LS109) — matched against channel keys and, for AsyncAPI 3, channel `address` values.

Feature files reference events by name (`event: BookingCreated`); when a catalog is configured, the name must exist (LS105). This applies both to event steps and to `message`/`signal` boundary handlers.

## Shared definitions (`definitions.yaml`)

An optional definitions catalog holds named, reusable **actors** and **step templates** that any feature in the workspace can pull in with a `$ref`:

```yaml
version: "1"

actors:
  notifier:
    kind: service
    label: Notification Service

steps:
  send-notification:          # a step template: a step body without an id
    type: operation
    label: Send Notification
    actor: notifier
```

A feature references them with an intra-workspace pointer; the map key is the actor/step id, and any local keys shallow-merge over the resolved definition (**local wins**):

```yaml
actors:
  notifier:
    $ref: "definitions#/actors/notifier"
    label: Reminder Notifier   # local override

steps:
  notify:
    $ref: "definitions#/steps/send-notification"
    next: sent                 # the template left the transition to the caller
```

Rules:

* The only accepted reference syntax is `definitions#/actors/<name>` or `definitions#/steps/<name>`. Arbitrary file or URL references are rejected (LS111), as is a `$ref` whose section does not match its slot (an actor slot pointing at a step, or vice versa).
* An unknown target is LS110. Definitions may reference other definitions of the same section; cycles — and runaway chains or oversized expansions — are LS112.
* A step template may omit its outgoing transition (`next`/`on`) and leave it to the caller.
* **References expand before schema validation.** The loader resolves every `$ref` into a concrete actor/step on load, so schema validation, graph building, all validators, renderers, and diff operate on the fully resolved feature and never see a `$ref`. The merged result is validated against the strict actor/step schema, so an override key that is not a valid field is rejected as usual. A feature with no `$ref` passes through the pipeline byte-identical.

The catalog is configured as `catalogs.definitions` (below); without one, any `$ref` is an unresolved reference (LS110). Expansion bounds and whole-catalog validation are described in [validation.md](validation.md#pipeline).

## Workspace configuration (`logicspec.config.yaml`)

```yaml
version: "1"

features:
  directory: ./features    # default

catalogs:
  services: ./services.yaml
  events: ./events.yaml
  definitions: ./definitions.yaml   # optional — shared $ref definitions

output:
  directory: ./.logicspec   # default

render:
  view: flow               # flow | swimlane | sequence | event-model, default flow
  direction: TD            # TD | TB | LR | RL | BT, default TD

diagnostics:               # optional per-code severity overrides
  LS200: "error"           # error | warning | info | off
  LS402: "off"
```

Tools locate the config by walking up from the file being processed. All config paths resolve relative to the config file's directory. CLI flags override configuration. Without a config file, defaults apply and catalog/subflow validation is skipped.

`diagnostics` maps diagnostic codes (`LS` + three digits) to a replacement severity, or `"off"` to suppress the finding entirely. Overrides change presentation and outcome, never the code itself; see [validation.md](validation.md#severity-overrides).

## Renderer behavior

Renderers consume the normalized model, never raw YAML, and must be deterministic: nodes and edges appear in source order, and the same document always produces byte-identical output.

The flowchart renderer:

* emits a `START` circle plus one node per step;
* encodes step type as **shape** and as a text marker in the label (`Reserve Slot` / `OPERATION`), so meaning survives light/dark themes, print, and monochrome;
* shapes: page → rectangle, decision → diamond, operation and subflow → subroutine, event → flag, wait → stadium, parallel → parallelogram, error → marked rectangle, final → double circle (label includes `FINAL · <outcome>`, suffixed `⦻ TERMINATE` for terminated finals and `⊗ ERROR` for non-terminated `failure` outcomes);
* refines markers where a step carries more meaning: typed events read `EVENT · <KIND>`, table-driven decisions read `DECISION TABLE · <POLICY> · <N> rules`; boundary handlers render as plain labeled edges bearing their trigger marker;
* draws agent zones as labelled subgraph clusters (`🤖 <label>`) around their member steps; a feature without zones renders exactly as before;
* renders waiting-event edges dotted, all others solid;
* escapes all user text with Mermaid entity codes (`#quot;`, `#lt;`, `#gt;`, `#amp;`, `#35;`) — a label can never break diagram syntax;
* keeps internal node ids independent from display labels.

Three further views exist, all experimental and all under the same determinism and escaping rules — swimlane (per-actor subgraph lanes), sequence (actor interaction map as a Mermaid `sequenceDiagram`), and event-model (Interface / Logic / Events / Outcomes lanes). A workspace-level dependency graph (`logicspec graph`) renders features, subflow edges and event publish/wait relationships. Details and examples: [views.md](views.md).

Generated Markdown always carries a **GENERATED FILE — DO NOT EDIT** warning naming the source file. The YAML is authoritative; diagrams are documentation.

### Source positions (tooling note, non-normative)

Diagnostics resolve document paths to 1-based `line`/`column` positions and, where the underlying YAML node is known, `endLine`/`endColumn` — enough for editors to underline the exact offending range rather than a single character.

## What LogicSpec is not

* Not a workflow engine: nothing executes, waits, or retries at runtime.
* Not a programming language: no scripts, no evaluated expressions (`expression`, `when`, `notes`, labels are data).
* Not an API description language: catalogs identify operations and events; OpenAPI/AsyncAPI describe their contracts.

## Extension strategy

The language grows by need, not speculation:

1. Custom data → namespaced `extensions`.
2. New semantics with a sound design → a proposal issue, then possibly a new minor capability within version 1 (additive, non-breaking).
3. Anything that changes existing meaning → DSL `version: "2"`.
