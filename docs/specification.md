# LogicSpec Specification v0.1

This document is the normative definition of the LogicSpec language, version 0.1. All other documents in this repository explain, motivate, or extend this specification; where they disagree, this document wins.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

**Status:** Draft. LogicSpec is in Phase 0 (specification only — see [roadmap.md](roadmap.md)).

---

## Document envelope

A LogicSpec document is a YAML file. Document files MUST match the glob `*.logic.yaml`, except the workspace root manifest, which MUST be named `logicspec.yaml`.

Every document MUST begin with the envelope keys:

```yaml
logicSpec: "0.1"
kind: feature
module: booking
```

- `logicSpec` — MUST be present and MUST be the string `"0.1"` for this version.
- `kind` — MUST be present and MUST be one of the [document kinds](#document-kinds).
- `module` — declares [module membership](modules.md). It MAY appear on `feature`, `service`, and `events` documents. It MUST NOT appear on `workspace` documents. Its value MUST be a module ID, never a file path.

A document's identity comes from its IDs, never from its file path. Tooling MUST NOT derive semantic identity from physical location. See [references.md](references.md).

## Document kinds

Version 0.1 defines five document kinds:

| Kind | Purpose | Body key |
|------|---------|----------|
| `workspace` | Workspace root manifest and discovery configuration | `workspace:` |
| `module` | A logical application area (booking, payment, …) | `module:` |
| `feature` | A user-facing flow of steps | `feature:` |
| `service` | A backend service exposing operations | `service:` |
| `events` | Event definitions shared across the workspace | `events:` |

Each document MUST contain exactly the body key matching its `kind`.

Future versions may introduce `entities`, `policies`, `integration`, `application`, and `architecture`. These names are reserved and are **not** normatively defined in v0.1.

## Workspace manifest

A workspace SHOULD have exactly one root manifest, `logicspec.yaml`, at the workspace root:

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

- A workspace MUST NOT contain more than one workspace document.
- `discovery.include` and `discovery.exclude` are glob lists controlling [document discovery](discovery.md). When omitted, tooling MUST default to including `**/*.logic.yaml` and excluding `node_modules/**`, `.git/**`, `dist/**`, and `build/**`.
- The root manifest is configuration, not generated state. Tooling MUST NOT write derived information (module lists, counts, indexes) into it. See [workspaces.md](workspaces.md).

## Module documents

```yaml
logicSpec: "0.1"

kind: module

module:
  id: booking
  name: Booking
  description: >
    Contains booking, availability and reservation behavior.
```

- `id` and `name` are REQUIRED; `description` is OPTIONAL.
- A module document MAY live anywhere below the workspace root. Moving the file MUST NOT change the module's identity.

## Feature documents

A feature describes one user-facing flow as a set of named steps:

```yaml
logicSpec: "0.1"

kind: feature

module: booking

feature:
  id: create-booking
  name: Create Booking
  description: >
    A customer books an appointment.
  actors: [customer]

  context:
    service: Service
    slot: Slot

  start: select-service

  steps:
    select-service:
      type: page
      actions:
        next: check-availability
        cancel: cancelled

    check-availability:
      type: operation
      call: booking-service.check-availability
      on-success: checkout
      on-error:
        no-slots: no-slots-error

    checkout:
      type: page
      actions:
        confirm: confirm-booking
        cancel: cancelled

    confirm-booking:
      type: publish
      event: BookingCreated
      next: success

    success:
      type: outcome
      result: success

    cancelled:
      type: outcome
      result: cancelled

    no-slots-error:
      type: outcome
      result: failure
```

Rules:

- `id`, `name`, `start`, and `steps` are REQUIRED. `description`, `actors`, and `context` are OPTIONAL.
- `actors` lists who drives the flow (kebab-case names). v0.1 does not define actors normatively beyond naming.
- `context` declares named data carried through the flow. In v0.1 the values are informal type names; a formal type system is an [open question](open-questions.md).
- `start` MUST reference a step ID defined in `steps`.
- Every transition target (`next`, action targets, branch targets, `on-success`, `on-error` targets, `timeout`) MUST be a step ID defined in the same feature.
- A step that no path can reach is an *unreachable step* — a diagnostic future tooling MUST report (see [references.md](references.md)).

### Step types

Every step MUST have a `type`, one of the six below. The set of step types is closed in v0.1.

#### `page`

A UI state presented to an actor.

```yaml
select-service:
  type: page
  actions:
    next: check-availability
    cancel: cancelled
```

- `actions` is REQUIRED: a map of action name (kebab-case) → target step ID.

#### `operation`

A call to a service operation.

```yaml
reserve-slot:
  type: operation
  call: booking-service.reserve-slot
  on-success: checkout
  on-error:
    slot-conflict: slot-conflict-error
```

- `call` is REQUIRED and MUST have the form `<service-id>.<operation-id>`.
- `on-success` is OPTIONAL: target step on success.
- `on-error` is OPTIONAL: a map of error ID (as declared by the operation) → target step.

#### `decision`

A branch on a business condition.

```yaml
confirm-cancel:
  type: decision
  when: booking starts more than 24 hours from now
  branches:
    refundable: cancel-with-refund
    non-refundable: cancel-without-refund
```

- `when` is REQUIRED: the condition as prose in v0.1 (a formal expression language is an open question).
- `branches` is REQUIRED: a map of case name → target step ID.

#### `publish`

Emit an event.

```yaml
confirm-booking:
  type: publish
  event: BookingCreated
  next: success
```

- `event` is REQUIRED and MUST be an event name.
- `next` is OPTIONAL: target step after publishing.

#### `wait`

Suspend the flow until an event arrives. This is the v0.1 primitive for asynchronous workflows.

```yaml
await-payment:
  type: wait
  event: PaymentCompleted
  next: create-booking
  timeout: payment-timeout-error
```

- `event` is REQUIRED.
- `next` is OPTIONAL: target step when the event arrives.
- `timeout` is OPTIONAL: target step if the event does not arrive. v0.1 does not define timeout durations.

#### `outcome`

A terminal state of the feature.

```yaml
success:
  type: outcome
  result: success
```

- `result` is OPTIONAL, one of `success`, `failure`, `cancelled`.
- An `outcome` step MUST NOT have transitions.

## Service documents

```yaml
logicSpec: "0.1"

kind: service

module: booking

service:
  id: booking-service
  name: Booking Service

  operations:
    check-availability:
      description: Return available slots for a service.
      input:
        service: Service
      output:
        slots: SlotList
      errors: [no-slots]

    reserve-slot:
      description: Reserve a time slot.
      input:
        slot: Slot
      output:
        reservation: Reservation
      errors: [slot-conflict]
      publishes: [BookingCreated]
```

Rules:

- `id`, `name`, and `operations` are REQUIRED.
- Each operation MAY declare `description`, `input`, `output`, `errors`, and `publishes`.
- `input` and `output` are informal name → type-name maps in v0.1.
- `errors` lists error IDs (kebab-case) that features MAY route on via `on-error`.
- `publishes` lists event names the operation emits.

## Events documents

```yaml
logicSpec: "0.1"

kind: events

events:
  BookingCreated:
    description: A booking was successfully created.
    payload:
      bookingId: string
```

- The body is a map of event name → definition.
- `description` and `payload` are OPTIONAL; `payload` is an informal name → type-name map in v0.1.
- An `events` document MAY declare `module` membership, or omit it for workspace-wide contracts.

## Identifiers

| Identifier | Casing | Pattern |
|------------|--------|---------|
| Module, feature, service, operation, step, action, error, actor IDs | kebab-case | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` |
| Event names | PascalCase | `^[A-Z][A-Za-z0-9]*$` |

Uniqueness rules for v0.1:

| Identifier | Unique within |
|------------|---------------|
| Module ID | workspace |
| Feature ID | workspace |
| Service ID | workspace |
| Event name | workspace |
| Step ID | its feature |
| Operation ID | its service |

Tooling MUST report duplicate identifiers as diagnostics. Whether IDs eventually become module-scoped (`booking/create`) is an [open question](open-questions.md) — v0.1 deliberately avoids namespace semantics.

## References

Semantic references MUST use identity, never file paths:

| Reference | Form | Resolves to |
|-----------|------|-------------|
| `module:` | module ID | module document |
| `call:` | `<service-id>.<operation-id>` | operation in a service document |
| `event:` / `publishes:` | event name | event definition |
| `next:`, `start:`, action / branch / `on-success` / `on-error` / `timeout` targets | step ID | step in the same feature |

```yaml
# Correct
module: booking

# Wrong — never reference by path
module: ../../domains/booking/booking.module.logic.yaml
```

Reference resolution is the job of workspace tooling (the future indexer), not of the YAML files themselves. An unresolved reference is a diagnostic, not a parse error. See [references.md](references.md) for resolution and diagnostic details, and [discovery.md](discovery.md) for how documents are found.

## Validation layers

1. **Shape validation** — a single document's structure. Machine-checkable today via the [JSON Schema](../schema/logicspec-0.1.schema.json).
2. **Identity validation** — cross-document reference resolution and uniqueness. Requires the workspace index (Phase 1); the diagnostics it MUST produce are specified in [references.md](references.md).
