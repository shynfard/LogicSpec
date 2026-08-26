# Booking Notification

> **GENERATED FILE — DO NOT EDIT.**
>
> Source: `examples/booking/notify-booking.feature.yaml`
> Regenerate with `logicspec render examples/booking/notify-booking.feature.yaml`.

Sends the customer a confirmation after a booking is created.

```mermaid
flowchart TD
  START(("Start"))
  wait_booking>"Wait for Booking<br/>EVENT"]
  load_preference[["Load Channel Preference<br/>OPERATION"]]
  pick_channel{"Preferred channel?<br/>DECISION"}
  send_confirmation[["Send Confirmation<br/>OPERATION"]]
  notify_error["Notification Failed<br/>ERROR"]:::error
  notified((("Customer Notified<br/>FINAL · success")))
  gave_up((("Notification Abandoned<br/>FINAL · failure · ⊗ ERROR")))

  START --> wait_booking
  wait_booking -. "received" .-> load_preference
  wait_booking -. "timeout 1d" .-> gave_up
  load_preference --> pick_channel
  pick_channel -- "Email" --> send_confirmation
  pick_channel -- "Anything else" --> send_confirmation
  send_confirmation -- "success" --> notified
  send_confirmation -- "error" --> notify_error
  notify_error -- "Retry delivery" --> send_confirmation
  notify_error -- "Give up" --> gave_up

  classDef error stroke-width:2px,stroke-dasharray:4 3;
```

## Actors

- **Notification Service** (`notification`, service)
- **Pub/Sub** (`pubsub`, broker)
