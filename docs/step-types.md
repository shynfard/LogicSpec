# Step Types

LogicSpec has exactly nine step types. The vocabulary is closed: tools reject anything else, and custom data belongs under namespaced `extensions:`. This page is a practical reference; the normative rules live in the [specification](specification.md).

Every step supports the common properties `type` (required), `label`, `actor`, `description`, `tags`, `notes`, and `extensions`.

---

## `page`

A frontend screen or meaningful UI state. Pages carry the user-facing side of the flow: what the user sees and what they can do.

```yaml
select-time:
  type: page
  label: Select Time
  actor: frontend
  route: /booking/time

  requires:
    - selectedDate

  states:
    - loading
    - ready
    - empty
    - error

  load:
    - call: booking.get-availability
      on:
        success: ready
        empty: empty
        error: error

  actions:
    select:
      label: Select slot
      produces:
        - selectedSlot
      next: reserve-slot
    back:
      next: select-date
```

Two rules keep pages honest:

* **`states` are local UI states, not workflow steps.** `loading`/`ready`/`empty`/`error` describe the page itself; they never appear as graph nodes. `load.on` targets must be declared states.
* **Major behavior deserves a graph node.** An action should express a workflow transition — don't hide a backend call inside it. Instead of `actions.reserve.call: booking.reserve`, write `actions.reserve.next: reserve-slot` and give the reservation its own `operation` step. Backend work stays visible in the diagram and in review.

## `decision`

Branching business or application logic. Conditions are descriptive text — never evaluated.

```yaml
has-availability:
  type: decision
  label: Slots available?
  actor: booking
  expression: availability.count > 0

  cases:
    - label: "Yes"
      when: availability.count > 0
      next: select-time

  default:
    label: "No"
    next: no-slots
```

A decision needs at least one case or a default (LS303).

## `operation`

Meaningful backend or system work — usually the most important nodes in a feature.

```yaml
reserve-slot:
  type: operation
  label: Reserve Slot
  actor: booking
  call: booking.reserve-slot

  requires:
    - selectedSlot
  produces:
    - reservationId

  on:
    success:
      next: checkout
    conflict:
      next: slot-conflict
    error:
      next: reservation-error
```

With a single outcome, `next` is the shorthand:

```yaml
cancel-booking:
  type: operation
  call: booking.cancel-reservation
  next: cancelled
```

`next` and `on` are mutually exclusive (LS301). `call` references resolve against the service catalog when one is configured.

## `event`

Publish a domain event, or wait for one. Two directions, one type.

Publishing:

```yaml
booking-created:
  type: event
  label: Booking Created
  actor: booking
  direction: publish
  event: BookingCreated
  next: success
```

Waiting (with timeout):

```yaml
wait-payment:
  type: event
  label: Wait for Payment
  actor: booking
  direction: wait
  event: PaymentCompleted
  timeout: 15m

  on:
    received:
      next: confirm-booking
    timeout:
      next: payment-timeout
```

Publishing events use `next`; waiting events use `on.received` (and optionally `on.timeout` plus a `timeout` duration). Mixing directions and properties is rejected (LS302). Event names resolve against the event catalog when one is configured.

## `wait`

An intentional time delay.

```yaml
reservation-expiry:
  type: wait
  label: Reservation expires
  actor: booking
  duration: 10m
  next: release-reservation
```

Durations are human-readable (`500ms`, `90s`, `10m`, `1h 30m`, `2d`, `1w`) and only their format is validated.

## `subflow`

Invokes another feature file, making features reusable.

```yaml
payment:
  type: subflow
  label: Payment Flow
  flow: payment

  requires:
    - reservationId
  produces:
    - paymentId

  on:
    success:
      next: confirm-booking
    cancelled:
      next: payment-cancelled
    failure:
      next: payment-error
```

`flow` names another feature in the same workspace (its `feature.id`, or the file stem of its `*.feature.yaml`). Resolution is validated when workspace information is available (LS106). Like operations, `next` and `on` are mutually exclusive.

## `parallel`

Runs independent subflows concurrently. Deliberately simple: branches reference subflows only — there is no inline concurrency language.

```yaml
after-booking:
  type: parallel
  label: Post Booking Tasks

  branches:
    notification:
      flow: send-confirmation
    calendar:
      flow: sync-calendar

  wait: all      # or: any
  next: success
```

## `error`

A failure state — terminal, or recoverable through actions.

```yaml
slot-conflict:
  type: error
  label: Slot No Longer Available
  message: Someone else booked this slot.

  actions:
    choose-another:
      label: Choose another slot
      next: select-time
```

An error **without** actions is terminal: the flow ends there in failure. Errors with recovery actions form legitimate retry loops — those are valid and expected.

## `final`

A terminal outcome.

```yaml
success:
  type: final
  label: Booking Confirmed
  outcome: success
```

`outcome` is `success`, `failure`, or `cancelled`. A final step must not have outgoing transitions (LS300).
