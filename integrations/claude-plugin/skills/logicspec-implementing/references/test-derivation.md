# Worked test derivation: examples/booking

Source: `examples/booking/booking.feature.yaml` (19 steps, 28 transitions,
finals: `success`, `cancelled`). Method: the coverage rules from SKILL.md
applied mechanically. Enumerate edges first:

```bash
logicspec inspect examples/booking/booking.feature.yaml --json   # or MCP get_transitions
```

## 1. Final-outcome tests (rule 1)

| Test | Path |
|------|------|
| happy path → `success` | select-service → select-staff → select-date → check-availability(available) → select-time → reserve-slot(success) → checkout(pay) → create-payment(success) → create-booking(success) → booking-created → success |
| cancellation → `cancelled` | …reach checkout → cancel → cancel-booking → cancelled |

The happy path doubles as the primary **E2E** test: visit `/booking/service`
(route of `select-service`), take action "Select service", then the staff
page, date page, time page, `/booking/checkout`, action "pay", assert the
confirmation screen. Assert the `BookingCreated` event was published
(spec step `booking-created`).

## 2. Per-outcome operation matrix (rule 2)

| Operation step | Outcome | Expect |
|----------------|---------|--------|
| check-availability | `available` | time-selection page shown |
| check-availability | `empty` | `no-slots` error: actions change-date / change-staff |
| check-availability | `error` | `availability-error`: retry re-runs check-availability |
| reserve-slot | `success` | checkout page, `reservationId` produced |
| reserve-slot | `conflict` | `slot-conflict` error: choose-another → back to select-time |
| reserve-slot | `error` | `reservation-error`: retry |
| create-payment | `success` | create-booking runs |
| create-payment | `failure` | `payment-error`: retry re-attempts payment; cancel → cancel-booking → cancelled |
| create-booking | `success` | BookingCreated published → success final |
| create-booking | `error` | `booking-error`: retry |

Each row: mock/drive that outcome, assert the landing step's behavior.
That is 10 integration tests from one table — every `on:` edge covered.

## 3. Recovery-loop tests (rule 3)

One full iteration each: availability error → retry → available → continues;
payment failure → retry → success → booking completes. Also the
cross-recovery: slot-conflict → choose-another → pick new slot → reserve
succeeds.

## 4. Data-flow assertions (rule 6)

`get_data_flow` says (excerpt): `selectedService` produced by
`select-service.select`, required by `select-staff`, `select-date`,
`check-availability`; `reservationId` produced by `reserve-slot`, required
by `checkout`. In integration tests assert the value is present at each
consuming step; in E2E assert the checkout page reflects the reserved slot.

## 5. Event assertions

`booking-created` publishes `BookingCreated` (topic per `events.yaml`;
consumer: the notify-booking feature). Assert emission with the catalog
topic. The companion spec `notify-booking.feature.yaml` waits on it — its
own test suite covers `on.received` and `on.timeout` (rule 5).

## Checklist discipline

Tick each of the 28 transitions as a test exercises it. Anything unticked at
the end is either a missing test or dead behavior — if the spec says it
exists and no test can reach it, that finding goes back to the spec's owner
(`logicspec validate` already rejects truly unreachable steps, LS200).
