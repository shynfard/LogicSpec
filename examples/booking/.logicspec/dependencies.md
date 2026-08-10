# Workspace dependencies

> **GENERATED FILE — DO NOT EDIT.**
>
> Regenerate with `logicspec export`.

```mermaid
flowchart LR
  feature_booking[["Booking<br/>FEATURE"]]
  feature_notify_booking[["Booking Notification<br/>FEATURE"]]
  event_BookingCreated>"BookingCreated<br/>EVENT"]

  feature_booking -.-> event_BookingCreated
  event_BookingCreated -.-> feature_notify_booking
```
