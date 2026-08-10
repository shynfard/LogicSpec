# LogicSpec DSL v1 — condensed reference

Identifiers (step/actor/action/context/service/operation/event ids): start
with a letter, then letters/digits/`-`/`_`. Convention: kebab-case steps,
camelCase context, PascalCase events. Call refs: `<service>.<operation>`.

Every document: `version: "1"` + strict objects (unknown keys rejected).
`extensions:` maps namespaced keys (`ns/name`, must contain `/`) to anything;
allowed on documents, feature, steps, catalog entries.

## Shared step properties (all optional except `type`)

`type, label, actor, description, tags, notes, extensions`
`label` defaults to the step id. `actor` must be declared under `actors`.

## Per-type properties

### page
`route` · `requires: [ctx]` (needed before entering) · `states: [ids]`
(local UI states) · `load: [{ call, on: { outcome: state } }]` (background
data; `on` values must be declared states when `states` exists — LS107) ·
`actions: { <id>: { label?, requires?, produces?, next } }`
A page with no actions is a dead end (LS201) unless the flow should end —
then transition to a `final` instead.

### decision
`expression?` (opaque text, never evaluated) ·
`cases: [{ label?, when?, next }]` · `default: { label?, next }`
At least one case or a default (LS303).

### operation
`call?: svc.op` · `requires/produces: [ctx]` ·
`next: id` **XOR** `on: { <outcome>: { label?, next } }` (LS301)
Neither → dead end (LS201).

### event
`direction: publish | wait` · `event: Name` (catalog-checked, LS105)
publish → `next` only. wait → `on: { received: {next}, timeout?: {next} }` +
optional `timeout: <duration>`; no `next` (LS302).

### wait
`duration: <duration>` (required) · `next` (required)

### subflow
`flow: <feature-id-or-stem>` (workspace-checked, LS106) ·
`requires/produces` · `next` XOR `on` (on-keys checked against the target
feature's final outcomes — LS404)

### parallel
`branches: { <id>: { flow } }` (≥1, LS304) · `wait: all | any` (default all)
· `next` (required)

### error
`message?` · `actions: { <id>: { label?, next } }` — actionless error is a
terminal (counts as a failure ending).

### final
`outcome: success | failure | cancelled`. No outgoing anything (LS300).

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
catalogs: { services: ./services.yaml, events: ./events.yaml }
output: { directory: ./generated }
render: { view: flow, direction: TD }   # views: flow swimlane sequence event-model
diagnostics: { LS402: "off" }           # per-code: error|warning|info|off
```

## CLI

`logicspec init` · `validate [paths] [--strict] [--json]` (no paths = whole
workspace) · `render <paths> [--view] [--format md|mermaid] [--direction]
[--output]` · `inspect <paths> [--json]` · `watch [dir]` · `graph [dir]` ·
`diff <before> <after> [--json]` · `mcp [dir]`.
Exit codes: 0 ok · 1 validation errors · 2 parse/config/usage.
