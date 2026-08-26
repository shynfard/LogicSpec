# LogicSpec DSL v1 — condensed reference

Identifiers (step/actor/action/context/service/operation/event/zone-member
ids): start with a letter, then letters/digits/`-`/`_`. Convention: kebab-case
steps, camelCase context, PascalCase events. Call refs: `<service>.<operation>`.

Every document: `version: "1"` + strict objects (unknown keys rejected).
`extensions:` maps namespaced keys (`ns/name`, must contain `/`) to anything;
allowed on documents, feature, steps, catalog entries. NOTHING is ever
executed or evaluated: every `when`, expression, hit policy, timer and
boundary is descriptive documentation.

## Feature envelope

`version: "1"` · `feature: { id, name, description?, extensions? }` ·
`start: <step-id>` · `actors?: { <id>: {kind, label?, description?} | $ref }`
(kinds: `user frontend service broker external system agent`; `agent` = an
autonomous AI actor, gets its own swimlane) ·
`context?: { <id>: {type, description?} }` (types: `string number boolean
object array date datetime`) · `steps: { <id>: <step> | $ref }` ·
`zones?: [...]` (see Agent zones) · `extensions?`

## Shared step properties (all optional except `type`)

`type, label, actor, description, tags, notes, extensions`
plus `boundary: [...]` on `page` / `subflow` / `parallel` ONLY (LS308).
`label` defaults to the step id. `actor` must be declared under `actors`.

## Per-type properties

### page
`route` · `requires: [ctx]` (needed before entering) · `states: [ids]`
(local UI states) · `load: [{ call, on: { outcome: state } }]` (background
data; `on` values must be declared states when `states` exists — LS107) ·
`actions: { <id>: { label?, when?, requires?, produces?, next } }` · `boundary?`
`when` is a descriptive transition guard, never evaluated; present-but-blank
is LS306. A page with no actions is a dead end (LS201) unless the flow should
end — then transition to a `final` instead.

### decision
`expression?` (opaque text, never evaluated) ·
`cases: [{ label?, when?, next }]` **XOR** `decisionTable` (LS307) ·
`default: { label?, next }`
At least one case, a decision table, or a default (LS303).

`decisionTable` — DMN-style grid; every header/cell is descriptive text:

```yaml
decisionTable:
  hitPolicy: first       # unique(default)|first|priority|any|collect|ruleOrder|outputOrder — a label, never an evaluator
  inputs: [age, country] # input column headers (what is tested)
  outputs: [tier, next]  # ≥1; the reserved "next" column's cells are target step ids
  rules:                 # ≥1; when/then widths must match inputs/outputs
    - when: ["< 18", "-"]           # "-" or "" = any
      then: [ineligible, reject]
    - when: [">= 18", "US"]
      then: [prime, approve]
```

At most one reserved `next` output column; its cells may not be `-`/blank; no
`next` column requires a `default` (else a silent dead end). Other output
columns are descriptive result values. Bounds: 1000 rules, 50 inputs, 50
outputs, 500 chars per header/cell. All violations are LS307.

### operation
`call?: svc.op` · `requires/produces: [ctx]` ·
`next: id` **XOR** `on: { <outcome>: { label?, when?, next } }` (LS301)
`when` = descriptive guard (blank → LS306). Neither next nor on → LS201.

### event
`direction: publish | wait` ·
`eventKind?: timer | message | signal | error | conditional`
publish → `next` only. wait → `on: { received: {next}, timeout?: {next} }` +
optional `timeout: <duration>`; no `next` (LS302).

Per-kind fields (violations → LS305; a blank required field also LS305):

| kind | must set | must NOT set | direction |
|------|----------|--------------|-----------|
| absent / `message` / `signal` | `event: Name` (catalog-checked, LS105) | after at every name when | either |
| `timer` | exactly one of `after` (delay, e.g. `30d`) / `at` (absolute) / `every` (cadence) | event name when | wait only |
| `error` | — (`name?`: error code, not blank) | event after at every when | either |
| `conditional` | `when` (predicate) | event after at every name | wait only |

`after`/`every` use the duration format; `at` is free text. All descriptive,
never scheduled or evaluated.

### wait
`duration: <duration>` (required) · `next` (required)

### subflow
`flow: <feature-id-or-stem>` (workspace-checked, LS106) · `requires/produces`
· `next` XOR `on: { <outcome>: { label?, when?, next } }` (on-keys checked
against the target feature's final outcomes — LS404) · `boundary?`

### parallel
`branches: { <id>: { flow } }` (≥1, LS304) · `wait: all | any` (default all)
· `next` (required) · `boundary?`

### error
`message?` · `actions: { <id>: { label?, next } }` — actionless error is a
terminal (counts as a failure ending).

### final
`outcome: success | failure | cancelled` · `terminate?: bool` (default false;
`true` = ends the WHOLE flow instance, not just this path — e.g. a lapse that
kills every parallel branch). No outgoing anything (LS300).

## Boundary handlers (page / subflow / parallel only)

A documented alternative path taken when the step times out, errors, or
receives a message/condition WHILE still in progress. Never fired by the
tool. Steps with outcome maps (operation, waiting event) must use `on:` /
`on.timeout` instead — a boundary there is LS308.

```yaml
boundary:
  - eventKind: timer          # required: timer|message|signal|error|conditional
    after: 15m                # per-kind fields — same rules as typed events
    label: session idle       # optional edge label
    interrupting: false       # default true; false = spawns a parallel path
    next: session-expired     # required target step id
  - eventKind: error
    name: OutOfStock
    next: backorder
```

Per-kind (violations → LS308): timer → exactly one of `after`/`at`/`every`;
`message`/`signal` → `event: Name` (catalog-checked, LS105); `error` →
`name?`; `conditional` → `when`. Fields of another kind are rejected. Bounds:
1000 handlers per step, 500 chars per descriptive field.

## Agent zones (annotation only)

A zone demarcates a region of steps an autonomous AI agent drives, order not
fixed. Pure documentation: no control-flow change, no edges, nothing runs.
Pair with an actor of `kind: agent`.

```yaml
zones:
  - label: AI Triage               # required, ≤200 chars
    description: What the agent does here.   # optional, ≤1000 chars
    kind: agent                    # optional; "agent" is the only kind
    steps: [classify, enrich]      # ≥1 existing step ids; a step belongs to ≤1 zone
```

Unknown step, step claimed by two zones, empty `steps`, or bounds exceeded
(100 zones/feature, 1000 steps/zone) → LS309.

## Shared definitions ($ref)

`definitions.yaml` (configured as `catalogs.definitions`) holds named
reusable **actors** and **step templates**. A feature pulls one in with
`$ref`; extra keys are local overrides that shallow-merge over the resolved
definition (local wins), and the merged result is validated against the
strict actor/step schema:

```yaml
# definitions.yaml
version: "1"
actors:
  notifier: { kind: service, label: Notification Service }
steps:
  send-notification:      # template = step body, no id; may omit next/on
    type: operation
    actor: notifier

# in a feature
actors:
  notifier: { $ref: "definitions#/actors/notifier", label: Reminder Notifier }
steps:
  notify:
    $ref: "definitions#/steps/send-notification"
    next: sent            # caller supplies the id (map key) and the transition
```

Only `definitions#/actors/<name>` and `definitions#/steps/<name>` are
accepted — no file/URL refs (LS111; wrong section is also LS111). Unknown
target → LS110. Definitions may `$ref` other definitions of the SAME section;
cycles, chains >100 links, or >5 MB expanded output → LS112. Expansion
happens on load, before validation — the pipeline never sees a `$ref`.

## Durations

`^\d+ (ms|s|m|h|d|w)` segments, repeatable: `10m`, `90s`, `1h 30m`, `2d`.

## services.yaml

```yaml
version: "1"
services:
  booking:
    name: Booking Service
    operations:
      reserve-slot:
        kind: http            # http | grpc | internal | command | other
        method: POST          # http: method + path; grpc: service + method
        path: /reservations   # internal: operation; command: command
        openapi:              # optional, verified (LS108/LS403)
          document: ./openapi.yaml
          operationId: reserveSlot
```

## events.yaml

```yaml
version: "1"
events:
  BookingCreated:
    topic: booking.created
    producer: booking
    consumers: [notification]
    payload: { schema: ./schemas/booking-created.json }
    asyncapi:                 # optional, verified (LS109)
      document: ./asyncapi.yaml
      channel: booking.created
```

## logicspec.config.yaml

```yaml
version: "1"
features: { directory: ./features }
catalogs:
  services: ./services.yaml
  events: ./events.yaml
  definitions: ./definitions.yaml       # shared $ref actors/step templates
output: { directory: ./.logicspec }
render: { view: flow, direction: TD }   # views: flow swimlane sequence event-model
diagnostics: { LS402: "off" }           # per-code: error|warning|info|off
```

Every configured path must stay inside the workspace root — absolute paths
and `..` escapes are refused (LS005).

## CLI

`logicspec init` · `validate [paths] [--strict] [--json]` (no paths = whole
workspace) · `render <paths> [--view] [--format md|mermaid] [--direction]
[--output]` · `export [dir] [--output]` (full artifact build into
`.logicspec/`) · `inspect <paths> [--json]` · `watch [dir]` ·
`serve [dir] [--port] [--host] [--open]` (local read-only dashboard, default
http://127.0.0.1:27000) · `graph [dir] [--services] [--format] [--direction]`
· `diff <before> <after> [--json]` · `mcp [dir]`. Global `--debug` prints
stack traces. Exit codes: 0 ok · 1 validation errors · 2 parse/config/usage.
