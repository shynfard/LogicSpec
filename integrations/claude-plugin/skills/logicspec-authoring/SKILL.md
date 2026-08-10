---
name: logicspec-authoring
description: Author, edit and validate LogicSpec YAML specifications. Use when creating or modifying *.feature.yaml, services.yaml, events.yaml or logicspec.config.yaml files; when the user asks to design, spec or diagram feature logic (booking, checkout, signup, approval, onboarding flows); when they mention LogicSpec, feature specs, step types, or LS-code diagnostics; or before implementing a feature in a repo that contains a logicspec.config.yaml.
---

# LogicSpec authoring

LogicSpec describes application feature logic in YAML — pages, actions,
decisions, backend operations, events, waits, error paths, outcomes. The YAML
is the behavioral source of truth: it is validated and rendered, never
executed. Generated Markdown/Mermaid is documentation only — never hand-edit
it, and never infer behavior from a diagram when the YAML disagrees.

## The loop (always)

1. Write or edit the YAML.
2. `logicspec validate <file>` (or `logicspec validate` for the whole
   workspace). Exit 0 = clean; diagnostics carry stable `LS###` codes,
   file:line:column and "Did you mean" suggestions.
3. Fix every error; take warnings seriously (see references/diagnostics.md).
4. `logicspec render <file>` to refresh diagrams; `logicspec inspect <file>
   --json` for a machine-readable model.

Never leave a spec unvalidated after editing it. If the CLI is missing, try
`npx logicspec` or `node <repo>/dist/cli/main.js`.

## Document envelope

```yaml
version: "1"              # always the string "1"
feature:
  id: booking             # kebab-case identifier
  name: Booking
start: select-service     # id of the first step
actors:                   # optional; kinds: user frontend service broker external system
  frontend: { kind: frontend, label: Web App }
context:                  # optional; types: string number boolean object array date datetime
  reservationId: { type: string }
steps:                    # required map of step id → step
  ...
```

Strict schemas everywhere — unknown properties are rejected. Org-specific
data goes under `extensions:` with namespaced keys (`company.example/foo`).

## The nine step types — closed set, never invent others

| Type | Purpose | Transitions |
|------|---------|-------------|
| `page` | screen/UI state | `actions.<id>.next` (each may `requires`/`produces`) |
| `decision` | branching | `cases[].next` + optional `default.next`; ≥1 required |
| `operation` | backend work (`call: service.operation`) | `next` XOR `on.<outcome>.next` |
| `event` | pub/sub | `publish` → `next`; `wait` → `on.received/.timeout` + `timeout: 15m` |
| `wait` | time delay (`duration: 10m`) | `next` |
| `subflow` | invoke another feature (`flow: <id>`) | `next` XOR `on` (keys must match target's final outcomes) |
| `parallel` | run subflows (`branches`, `wait: all\|any`) | `next` |
| `error` | failure | `actions.<id>.next`; no actions = terminal |
| `final` | end (`outcome: success\|failure\|cancelled`) | none — ever |

Rules that trip people up:

- `next` and `on` are mutually exclusive (LS301). `next` = single unnamed
  outcome; `on` = named outcomes with `{ next: <step-id> }` values.
- Waiting events must not use `next`; publishing events must not use
  `on`/`timeout` (LS302).
- Every context name in `requires`/`produces` must be declared, and every
  `requires` must be **produced on every path from start** before it's needed
  (LS203) — put `produces` on the page action or operation that creates the
  value.
- Big behavior deserves its own step: never hide a backend call inside a page
  action — the action `next`s to an `operation` step with `call:`.
- Page `states` and `load.on` targets are LOCAL UI states, not workflow steps.
- Cycles are fine (retry loops) as long as some path reaches a terminal
  (final, or error without actions); a trapped loop is LS202.
- Durations: `10m`, `90s`, `1h 30m` (units ms s m h d w).

## Catalogs and workspace

`call: booking.reserve-slot` must exist in `services.yaml`; `event:` names
must exist in `events.yaml` when catalogs are configured in
`logicspec.config.yaml`. Operations may link `openapi: { document,
operationId }`, events `asyncapi: { document, channel }` — both verified.
Severity overrides live in config: `diagnostics: { LS402: "off" }`.

For the full grammar read `references/dsl-reference.md`; for every diagnostic
code and its fix read `references/diagnostics.md`.

## When implementing code in a repo with specs

Before writing implementation code: read the relevant feature YAML, run
`logicspec validate`, identify affected pages/operations/events/error paths,
and do not contradict the spec. If the requested change contradicts the spec,
update the spec first, validate, then implement.
