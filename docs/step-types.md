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

A decision needs at least one case, a decision table, or a default (LS303).

### Decision tables

For grid-shaped logic — the kind a domain expert reads as a table, not a graph — a decision can carry a `decisionTable` instead of free-form `cases`. It is a [DMN](https://www.omg.org/dmn/)-style table: input columns (the things being tested), output columns (the results), a hit policy, and a list of rules (rows). A decision uses **either** `cases` **or** a `decisionTable`, never both (LS307).

Like every predicate in LogicSpec, the cells are **descriptive text and are never evaluated**, and the hit policy is a **declarative label** — it documents how rules are meant to combine; the tool never picks a winner.

```yaml
assess:
  type: decision
  label: Assess Applicant
  actor: underwriting
  decisionTable:
    hitPolicy: first
    inputs:
      - age
      - country
    outputs:
      - tier
      - next
    rules:
      - when: ["< 18", "-"]
        then: ["ineligible", "reject"]
      - when: [">= 18", "US"]
        then: ["prime", "approve"]
      - when: [">= 18", "-"]
        then: ["standard", "review"]
```

| Field | Meaning |
|-------|---------|
| `inputs` | Column headers for the things being tested, e.g. `["age", "country"]`. |
| `outputs` | One or more result column headers. The reserved **`next`** column names the target step (see below); every other output is a descriptive result value, e.g. `tier`. |
| `hitPolicy` | One of `unique` (default), `first`, `priority`, `any`, `collect`, `ruleOrder`, `outputOrder` — the DMN hit policies. A label only, never evaluated. |
| `rules` | The rows. Each rule has one `when` cell per input column and one `then` cell per output column. `-` or `""` in a `when` cell means "any". |

**Target-column convention.** At most one output column may be named `next` (a second one is LS307). When present, that column's cell in each rule is the step id the decision transitions to when the rule is selected — so a table-driven decision produces one branch per rule and stays a real flow. All the usual target checks apply to those cells: an unresolved target is [LS101](validation.md), and a step reachable only through a table branch is reachable for [LS200](validation.md). A reserved `next` cell must name a real step; `-` or blank is not a valid target (LS307). If you omit the `next` column the table is a pure classification/output table — it produces no branch of its own, so the decision **must** carry a `default` to continue; a classification table with neither a `next` column nor a `default` is a dead end (LS307).

Rules are validated for shape (LS307): each rule's `when` width must equal the number of inputs, each rule's `then` width must equal the number of outputs, the table must declare at least one output column, and it must have at least one rule. Tables are also bounded to keep validation cheap — at most 1000 rules, 50 input columns, 50 output columns, and 500 characters per header or cell; exceeding any bound is LS307.

In the flowchart the node keeps the decision diamond but its marker becomes `DECISION TABLE · <HIT POLICY> · N rules`, and each rule renders as a branch labelled by its descriptive outputs (e.g. `tier: prime`). Note that the diagram shows every rule as a branch, not the one the hit policy would select. The full table — inputs, outputs, hit policy and rule count — is exposed on the graph node, and the complete rule grid is available through the MCP `get_step` tool.

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

Each named outcome may carry an optional `when` — a descriptive guard on that transition, never evaluated (same semantics as a decision `cases[].when`):

```yaml
reserve-slot:
  type: operation
  call: booking.reserve-slot
  on:
    success:
      when: the slot is still free
      next: checkout
    conflict:
      next: slot-conflict
```

Guards are also allowed on `subflow` outcomes and on `page` `actions`. They render on the edge label as `[when: …]`.

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

### Typed events

An optional `eventKind` classifies the event, BPMN-style. When it is absent the event keeps the generic behavior above. Each kind carries its own natural fields:

| `eventKind` | Fields | Notes |
|-------------|--------|-------|
| `timer` | exactly one of `after` / `at` / `every` | `after` and `every` reuse the `wait` duration format (`15m`, `1d`); `at` is a descriptive date/time. All three are **descriptive, never scheduled** — `every` is a documented cadence, not a live schedule |
| `message` | `event` | a named message, resolved against the event catalog |
| `signal` | `event` | a broadcast signal, resolved against the event catalog |
| `error` | optional `name` | a descriptive error name/code |
| `conditional` | `when` | a descriptive predicate, never evaluated (like a decision `when`) |

```yaml
renewal-window:
  type: event
  label: Renewal window reached
  actor: scheduler
  direction: wait
  eventKind: timer
  after: 30d
  on:
    received:
      next: charge-card
```

Rules (LS305): an unknown `eventKind` is rejected (LS002); a `timer` needs exactly one of `after`/`at`/`every`; `message`/`signal`/generic events must name an `event`; a `conditional` must set `when`; and fields belonging to another kind (a timer field on a message event, an `event` name on a timer, …) are rejected. Every required per-kind field must be **non-blank** — an empty string (`event: ""`, `when: ""`, `at: ""`) does not satisfy the requirement. A `timer` and a `conditional` are *catch* events: they must use `direction: wait`, never `direction: publish`. The kind shows in the diagram marker (`EVENT · TIMER`) so a timer reads differently from a message.

> **`eventKind: error` (an error *event*) is not the `error` *step type*.** They are different concepts that happen to share a word. An **error event** (`type: event`, `eventKind: error`) models catching or emitting an error signal within the event vocabulary — it is still an event step and follows the publish/wait rules. The **`error` step** (below) is a first-class failure state with an optional recovery `actions` map; without actions it is a terminal failure. Reach for the `error` step when you are modelling a failure the flow lands in and may recover from; reach for `eventKind: error` only when you are classifying an actual event as error-shaped. Don't conflate them.

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

An optional `terminate: boolean` (default `false`) marks a terminal that ends the **whole flow instance**, not just the current path — useful alongside `parallel` branches, where a normal final would only end one branch:

```yaml
lapsed:
  type: final
  label: Subscription Lapsed
  outcome: failure
  terminate: true
```

A final's `kind` is derived, never stored: `terminate: true` ⇒ `terminate`; otherwise `outcome: failure` ⇒ `error`; everything else ⇒ `normal`. The three-way distinction renders as distinct diagram markers: a terminated final shows `⦻ TERMINATE`, an error terminal (`outcome: failure`) shows `⊗ ERROR`, and a normal terminal shows just its outcome. The derivation is exposed as `finalKind()` in the public API.
