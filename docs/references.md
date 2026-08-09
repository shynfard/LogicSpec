# References and Diagnostics

LogicSpec references use **identity, not file paths**. This is the design principle that makes the workspace location-independent: moving a file never changes the application architecture.

## Reference forms

| Reference | Form | Resolves to | Scope |
|-----------|------|-------------|-------|
| `module:` | module ID | module document | workspace |
| `call:` | `<service-id>.<operation-id>` | operation in a service document | workspace |
| `event:`, `publishes:` | event name | event definition | workspace |
| `start:`, `next:`, action targets, branch targets, `on-success`, `on-error` targets, `timeout` | step ID | step | same feature |

```yaml
# Correct — identity
module: booking
call: booking-service.reserve-slot
event: BookingCreated
next: checkout

# Wrong — never paths
module: ../../domains/booking/booking.module.logic.yaml
flow: ../payment/payment.logic.yaml
```

Tooling resolves identifiers to source files via the [workspace index](discovery.md); humans navigate the same way ([Go to Definition](vscode-extension.md#go-to-definition)).

## Uniqueness

| Identifier | Unique within |
|------------|---------------|
| Module ID | workspace |
| Feature ID | workspace |
| Service ID | workspace |
| Event name | workspace |
| Step ID | its feature |
| Operation ID | its service |

Tooling MUST detect duplicates wherever ambiguity would result. Whether IDs eventually become globally unique or module-scoped (`booking/create`) is deliberately unresolved — see [open-questions.md](open-questions.md). v0.1 does not invent namespace semantics.

## Diagnostics

An unresolved reference is a **diagnostic, not a parse error**: the document is still valid YAML with a valid shape; the workspace is what's inconsistent. Tooling MUST report at least:

| Diagnostic | Trigger | Example message |
|------------|---------|-----------------|
| Unknown module | `module:` names no module document | `Unknown module: bookings` |
| Unknown step | transition target not defined in the feature | `Unknown step: chekout` |
| Unknown operation | `call:` names a missing service or operation | `Unknown operation: booking-service.reserve-slto` |
| Unknown event | `event:`/`publishes:` names an undefined event | `Unknown event: BookingCrated` |
| Undeclared error route | `on-error` key the operation does not declare | `Operation booking-service.reserve-slot does not declare error: no-slots` |
| Unknown input | `with:` key not declared by the operation | `Unknown input: booking-service.reserve-slot.slott` |
| Unknown output | `into:` value not declared by the operation | `Unknown output: booking-service.reserve-slot.reservaton` |
| Unknown payload field | `with:`/`into:` against an undeclared event payload field | `Unknown payload field: BookingCreated.bookingID` |
| Unknown context key | mapping references undeclared feature context | `Unknown context key: reservatoin` |
| Duplicate module ID | two module documents share an ID | `Duplicate module ID: booking` |
| Duplicate feature ID | two features share an ID | `Duplicate feature ID: create-booking` |
| Duplicate service ID | two services share an ID | `Duplicate service ID: payment-service` |
| Duplicate event | two definitions of one event name | `Duplicate event: BookingCreated` |
| Unreachable step | no path from `start` reaches the step | `Unreachable step: booking-error` |

Every diagnostic MUST point to the relevant source range (file, line, column) using the source locations retained in the index ([discovery.md](discovery.md#source-locations)). The [VS Code extension](vscode-extension.md#diagnostics) surfaces these as editor diagnostics; `validate_workspace` exposes them [to AI agents](ai-integration.md).
