---
name: logicspec-authoring
description: Author, edit and validate LogicSpec YAML specifications — the full DSL including decision tables, typed events, boundary handlers, agent zones, guarded outcomes and $ref shared definitions. Use when creating or modifying *.feature.yaml, services.yaml, events.yaml, definitions.yaml or logicspec.config.yaml files; when the user asks to design, spec or diagram feature logic (booking, checkout, signup, approval, onboarding flows); when they mention LogicSpec, feature specs, step types, or LS-code diagnostics; or before implementing a feature in a repo that contains a logicspec.config.yaml.
---

# LogicSpec authoring

LogicSpec describes application feature logic in YAML — pages, actions,
decisions, backend operations, events, waits, error paths, outcomes. The YAML
is the behavioral source of truth: it is validated and rendered, never
executed — every `when`, expression, hit policy, timer and boundary is
descriptive documentation. Generated Markdown/Mermaid is documentation only —
never hand-edit it, and never infer behavior from a diagram when the YAML
disagrees.

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
actors:                   # optional; kinds: user frontend service broker external system agent
  frontend: { kind: frontend, label: Web App }
context:                  # optional; types: string number boolean object array date datetime
  reservationId: { type: string }
steps:                    # required map of step id → step (a value may be a $ref)
  ...
zones:                    # optional; annotate AI-agent-driven regions of steps
  - { label: AI Triage, steps: [classify, enrich] }
```

Strict schemas everywhere — unknown properties are rejected. Org-specific
data goes under `extensions:` with namespaced keys (`company.example/foo`).
Actors and steps may be `$ref`s to shared definitions (see below).

## The nine step types — closed set, never invent others

| Type | Purpose | Transitions |
|------|---------|-------------|
| `page` | screen/UI state | `actions.<id>.next` (each may `when`/`requires`/`produces`); may carry `boundary` |
| `decision` | branching | `cases[].next` XOR `decisionTable` (reserved `next` output column) + optional `default.next`; ≥1 required |
| `operation` | backend work (`call: service.operation`) | `next` XOR `on.<outcome>.next` (outcomes may carry a `when` guard) |
| `event` | pub/sub, optionally typed `eventKind: timer\|message\|signal\|error\|conditional` | `publish` → `next`; `wait` → `on.received/.timeout` + `timeout: 15m` |
| `wait` | time delay (`duration: 10m`) | `next` |
| `subflow` | invoke another feature (`flow: <id>`) | `next` XOR `on` (keys must match target's final outcomes); may carry `boundary` |
| `parallel` | run subflows (`branches`, `wait: all\|any`) | `next`; may carry `boundary` |
| `error` | failure | `actions.<id>.next`; no actions = terminal |
| `final` | end (`outcome: success\|failure\|cancelled`; `terminate: true` ends the whole instance) | none — ever |

Rules that trip people up:

- `next` and `on` are mutually exclusive (LS301). `next` = single unnamed
  outcome; `on` = named outcomes with `{ next: <step-id> }` values.
- Waiting events must not use `next`; publishing events must not use
  `on`/`timeout` (LS302). Typed events need their kind's fields — timer:
  exactly one of `after`/`at`/`every` and `direction: wait`; message/signal:
  an `event` name; conditional: `when` and wait (LS305).
- `cases` and `decisionTable` are mutually exclusive (LS307); a table needs a
  reserved `next` output column or a `default`.
- `boundary` handlers (mid-flight timeout/error/message/condition paths)
  attach only to `page`, `subflow` and `parallel` (LS308) — operations and
  waiting events already have `on:`/`on.timeout`.
- Every context name in `requires`/`produces` must be declared, and every
  `requires` must be **produced on every path from start** before it's needed
  (LS203) — put `produces` on the page action or operation that creates the
  value.
- A `when` guard is descriptive, never evaluated — and never blank (LS306).
- `details: [flow, other-flow: note]` (any step) links flows that REFINE the
  step — documentation only, no edge/invocation/contract (invoking = subflow).
  Unknown flow → LS113 warning.
- Zone `steps` must name existing steps, one zone per step (LS309). Zones are
  annotations: no control-flow effect.
- Big behavior deserves its own step: never hide a backend call inside a page
  action — the action `next`s to an `operation` step with `call:`.
- Page `states` and `load.on` targets are LOCAL UI states, not workflow steps.
- Cycles are fine (retry loops) as long as some path reaches a terminal
  (final, or error without actions); a trapped loop is LS202.
- Durations: `10m`, `90s`, `1h 30m` (units ms s m h d w).

## Catalogs and workspace

`call: booking.reserve-slot` must exist in `services.yaml`; `event:` names
(on event steps and message/signal boundaries) must exist in `events.yaml`
when catalogs are configured in `logicspec.config.yaml`. Operations may link
`openapi: { document, operationId }`, events `asyncapi: { document, channel
}` — both verified. A `definitions.yaml` catalog (`catalogs.definitions`)
holds shared actors and step templates that features pull in with
`$ref: "definitions#/actors/<name>"` / `"definitions#/steps/<name>"`; local
keys override the resolved definition (local wins). Severity overrides live
in config: `diagnostics: { LS402: "off" }`.

For the full grammar read `references/dsl-reference.md`; for every diagnostic
code and its fix read `references/diagnostics.md`. Both cover the complete
current language (0.16): decision tables, typed events, boundary handlers,
agent zones, guarded outcomes, `final.terminate`, `$ref` shared definitions
and `details` refinement links.

## When implementing code in a repo with specs

Before writing implementation code: read the relevant feature YAML, run
`logicspec validate`, identify affected pages/operations/events/error paths,
and do not contradict the spec. If the requested change contradicts the spec,
update the spec first, validate, then implement. For the full consuming-side
method — step-type → implementation obligations, and deriving unit/
integration/E2E tests from a spec — use the `logicspec-implementing` skill.
