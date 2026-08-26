# Example workspaces

Each directory is a self-contained LogicSpec workspace: a `logicspec.config.yaml`
plus one or more `*.feature.yaml` files. Nothing in them is ever executed — they
are specifications, and the toolchain parses, validates and renders them.

Validate or browse any of them from the repo root:

```bash
node dist/cli/main.js validate examples/<dir>   # or: logicspec validate examples/<dir>
node dist/cli/main.js serve examples/<dir>      # read-only dashboard at http://127.0.0.1:27000
```

| Workspace | Demonstrates |
|-----------|--------------|
| [`booking/`](booking/) | The canonical workspace. Two features linked by a published event (`booking` emits `BookingCreated`, `notify-booking` waits for it), service and event catalogs cross-checked against real OpenAPI/AsyncAPI documents, and a config severity override (`LS402: "off"`). Most step types appear, including error steps with recovery actions. |
| [`fulfillment/`](fulfillment/) | Composition and boundary events (v0.8). `order-fulfillment` calls `warehouse-fulfilment` through a `subflow` step whose `on:` keys are contract-checked against the called feature's final outcomes (LS404), fans out to `send-email`/`send-sms` via a `parallel` step, and attaches timer/message/error boundaries — interrupting and non-interrupting — to page, subflow and parallel steps. |
| [`pricing/`](pricing/) | A decision table (v0.7). The `assess` decision uses a rule grid with a `first` hit policy instead of free-form cases; the reserved `next` output column makes each rule a real typed branch in the flow. |
| [`reminders/`](reminders/) | Typed events and delays (v0.6). A timer event starts the flow, message and signal events are published, operation outcomes and page actions carry descriptive `when` guards, a `terminate: true` final ends the whole instance — and a core `wait` step models the dunning grace period as a plain duration delay. |
| [`shared/`](shared/) | `$ref` reuse. A `definitions.yaml` catalog holds a shared actor and a shared step template; the feature pulls both in via `$ref` and shallow-merges local overrides on top. See [`shared/README.md`](shared/README.md). |
| [`triage/`](triage/) | Agent zones (v0.9). An actor with `kind: agent` and a `zones:` annotation bound a stretch of steps as an autonomous AI region — order not fixed, purely descriptive — before the flow hands back to a human approval step. |

`examples/booking/` is the style reference used by the test suite; its
`.logicspec/` directory holds the artifacts produced by `export`.
