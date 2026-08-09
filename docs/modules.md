# Modules

A module represents a logical application area: booking, payment, authentication, customer, notification, admin. Modules give a workspace its top-level structure without dictating where files live.

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

A module document may physically exist anywhere in the workspace — `domains/booking/`, `backend/modules/`, anywhere. Its location does not change its identity ([workspaces.md](workspaces.md)).

## Module membership

Other documents associate themselves with a module through the `module:` envelope key:

```yaml
logicSpec: "0.1"

kind: feature

module: booking

feature:
  id: create-booking
  name: Create Booking
  start: select-service
  steps:
    select-service:
      type: page
      actions:
        next: done
    done:
      type: outcome
```

The value is always the module **ID**, never a file path. A `service` or `events` document declares membership the same way; `events` documents MAY omit it for workspace-wide contracts (see the example's [contracts/events.logic.yaml](../examples/salon-platform/contracts/events.logic.yaml)).

## Derived module trees

Because membership is declared on the member, tooling constructs the module's contents automatically:

```text
Booking
├── Features
│   ├── Create Booking
│   └── Cancel Booking
├── Services
│   └── Booking Service
└── Events
    └── BookingCreated
```

The module document never enumerates its members. Adding a feature to a module means adding `module: booking` to the feature file — nothing else changes.

## Derived module overviews

From the [workspace index](discovery.md), tooling can derive a full module overview:

```text
Booking

Features        create-booking, cancel-booking
Services        booking-service
Publishes       BookingCreated, BookingCancelled, PaymentRequested
Consumes        PaymentCompleted
Dependencies    payment (via PaymentRequested/PaymentCompleted)
```

- **Publishes** — events emitted by the module's features (publish steps) and service operations (`publishes:`).
- **Consumes** — events its features wait on.
- **Dependencies** — modules reached through operation calls and event flows.

All of this is derived information. It lives in the index and in generated views ([VS Code](vscode-extension.md#module-overview), [MCP](ai-integration.md)), never in the module file.
