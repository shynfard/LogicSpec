# VS Code Extension

LogicSpec will have an official VS Code extension. It is **not** part of Phase 0 — this document specifies the desired experience now so the language is designed to support it cleanly. Implementation lands in Phase 2 of the [roadmap](roadmap.md), on top of the editor-independent core indexer (Phase 1).

Everything the extension shows is derived from the [workspace index](discovery.md). Nothing here requires — or permits — writing generated content into LogicSpec files.

## LogicSpec Explorer

A sidebar presenting the workspace structure:

```text
LOGICSPEC

Salon Platform

├── Modules
│   ├── Booking
│   │   ├── Features
│   │   │   ├── Create Booking
│   │   │   └── Cancel Booking
│   │   ├── Services
│   │   │   └── Booking Service
│   │   └── Events
│   │       └── BookingCreated
│   ├── Payment
│   │   ├── Features
│   │   │   └── Process Payment
│   │   └── Services
│   │       └── Payment Service
│   └── Notification
├── Features
├── Services
├── Events
└── Problems
```

The tree is generated from the index — it is never manually maintained.

## Navigation

Every Explorer item is clickable and opens the defining source:

- **Booking** → the file containing `module: { id: booking }`
- **Create Booking** → its feature document
- **Booking Service** → its service definition
- **BookingCreated** → its event definition

Navigation SHOULD target the exact source range of the definition.

## Go to Definition

`F12` / Ctrl(Cmd)+Click on any reference:

| Reference under cursor | Target |
|------------------------|--------|
| `module: booking` | module definition |
| `call: booking-service.reserve-slot` | operation definition |
| `event: BookingCreated` | event definition |
| `next: checkout` | step definition in the same feature |

## Find References

Finding references to `BookingCreated` might show:

```text
create-booking.logic.yaml     publishes BookingCreated
notify-on-booking.logic.yaml  waits for BookingCreated
events.logic.yaml             defines BookingCreated
```

Essential for understanding system impact before changing a contract.

## Root workspace overview

Opening `logicspec.yaml` provides access to a dynamically generated overview:

```text
Salon Platform

Modules:       3
Features:       4
Services:       3
Events:         4
Problems:       0

Booking         2 features   1 service
Payment         1 feature    1 service
Notification    1 feature    1 service
```

Clicking a module navigates to it. The overview is presentation over the index; the YAML file on disk stays exactly as authored ([workspaces.md](workspaces.md)).

## Module overview

```text
Booking

Features         Create Booking, Cancel Booking
Services         Booking Service
Consumes         PaymentCompleted
Publishes        BookingCreated, BookingCancelled, PaymentRequested
Dependencies     Payment, Notification
```

All entries navigate to definitions. Derivation rules in [modules.md](modules.md).

## Feature overview

```text
Create Booking

Start        select-service
Pages        select-service, select-staff, select-time, checkout
Operations   check-availability, reserve-slot, create-booking
Events       PaymentRequested (publish), PaymentCompleted (wait), BookingCreated (publish)
Errors       no-slots, slot-conflict, payment-timeout
Outcomes     success, cancelled, failure
```

Eventually accompanied by a workflow diagram (Phase 3).

## Workspace graph

Command: `LogicSpec: Open Workspace Graph` — the cross-module event flow derived from references:

```text
        ┌─────────────┐
        │   Booking   │
        └──────┬──────┘
               │ PaymentRequested
               ▼
        ┌─────────────┐
        │   Payment   │
        └──────┬──────┘
               │ PaymentCompleted
               ▼
        ┌─────────────┐
        │   Booking   │
        └──────┬──────┘
               │ BookingCreated
               ▼
        ┌──────────────┐
        │ Notification │
        └──────────────┘
```

## Diagnostics

LogicSpec validation problems appear as native VS Code diagnostics, pointing at the relevant source range:

```text
Unknown module: bookings
Unknown step: chekout
Duplicate service ID: payment-service
Unknown operation: booking-service.reserve-slto
Unreachable step: booking-error
```

The full catalog is specified in [references.md](references.md#diagnostics).

## Outline / document symbols

```text
create-booking.logic.yaml

Create Booking
├── Actors
├── Context
└── Steps
    ├── select-service
    ├── select-staff
    ├── select-time
    ├── reserve-slot
    ├── checkout
    └── success
```

## Hover

Hovering a reference shows its resolved definition:

```yaml
call: booking-service.reserve-slot
```

```text
Booking Service › Reserve Slot

Reserve a time slot.
Errors: slot-conflict

Defined in: backend/booking/booking-service.logic.yaml
```

```yaml
event: BookingCreated
```

```text
BookingCreated

Publishers: create-booking (feature)
Consumers:  notify-on-booking (feature)
```

## CodeLens (optional, not first release)

Declarations MAY show lenses such as:

```text
3 references | Open Diagram | Open Module | Validate Feature
```

Not required for the first extension release.

## Implementation guidance

- **Incremental indexing** — never rescan the workspace per keystroke; see the pipeline in [discovery.md](discovery.md#incremental-indexing).
- **File watching** — react to create/delete/rename/modify of `*.logic.yaml` files ([discovery.md](discovery.md#file-watching)).
- **Multi-root** — initial implementation supports one `logicspec.yaml` per VS Code workspace folder; multi-root is an implementation-stage decision ([open-questions.md](open-questions.md)).
- **Schema-first win** — even before the extension exists, files carrying the `# yaml-language-server: $schema=` header get validation and completion from the standard YAML extension via the [JSON Schema](../schema/logicspec-0.1.schema.json).
