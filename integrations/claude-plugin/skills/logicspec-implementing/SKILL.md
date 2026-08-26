---
name: logicspec-implementing
description: Read a LogicSpec feature spec as an implementation contract and derive tests from it — unit, integration and E2E. Use when implementing a feature in a repo that has *.feature.yaml specs; when the user asks to write tests, E2E tests, or a test plan for specified behavior; when verifying an implementation matches its spec; or when they ask "what does this feature do" about a *.feature.yaml. Complements logicspec-authoring (which covers writing specs).
---

# LogicSpec: implementing from specs and deriving tests

A feature spec is a behavioral contract: pages that exist, actions users can
take, operations that run, every outcome each one can have, the data each
step needs and creates, and every error/timeout path. Implementation must
satisfy it; tests must cover it. The YAML wins over any diagram, comment or
prose — never infer behavior from generated Mermaid when the YAML disagrees.

## How to read a feature

Never hand-parse YAML when the tooling can answer structurally:

- `logicspec inspect <file> --json` — the whole normalized model (steps,
  transitions, actors, context, outcomes, stats).
- Over MCP (when registered): `get_feature`, `get_step <id>`,
  `get_transitions [from]`, `get_data_flow [key]`,
  `get_service_dependencies`, `get_events`.
- `logicspec validate` FIRST. Never implement or test against a spec that
  does not validate — fix the spec (logicspec-authoring skill) or ask.

Reading order that works: `feature` meta → `start` → walk `steps` by
following transitions (not file order) → `context` (the data contract) →
`actors` (who owns what) → error steps and `boundary` arrays (the unhappy
paths) → `final` steps (the complete set of ways this feature can end).

## Step type → implementation obligation

| Spec construct | You must implement |
|----------------|--------------------|
| `page` + `route` | that screen at that route; one UI affordance per `action`; local `states` (loading/empty/error) as page-internal UI states |
| page action `produces` | capturing that data before following `next` |
| `operation` (`call: svc.op`) | a call to that catalog operation — and handling of **every** key in its `on:` map, not just `success` |
| `decision` / `decisionTable` | the branching logic the cases/rules describe (descriptive text → real predicates; keep rule order for `hitPolicy: first`) |
| `event` publish | emitting that event (topic per `events.yaml`) at that point |
| `event` wait (+`timeout`) | subscribing/awaiting with the timeout path wired to `on.timeout` |
| `wait` | a real delay/scheduling of that duration |
| `subflow` / `parallel` | invoking the other feature(s); mapping their final outcomes to this step's `on:` keys |
| `boundary` handlers | timeout/error/message/condition handling while the host step is in progress; `interrupting: false` = additional parallel path |
| `error` + actions | the failure state plus each recovery affordance |
| `final` (`terminate: true`) | terminal state; terminate ends the whole flow instance everywhere |
| `requires` | that data being available at that step — guaranteed by the spec's data-flow analysis, so a gap you find is a spec bug: report it |

Guards (`when:`) and expressions are descriptive text — translate their
*intent* into real conditions; if the text is too vague to implement, ask or
tighten the spec first.

## Deriving tests

Coverage rules (in priority order):

1. **Every final outcome** gets at least one test that reaches it. The
   shortest path to the `success` final is the happy-path test.
2. **Every `on:` outcome of every operation** gets a test: drive/mock the
   operation to return that outcome, assert the flow lands where the spec
   says. `get_transitions` enumerates the exact edge list — use it as the
   coverage checklist (aim: every edge exercised at least once).
3. **Every error step with actions** gets a recovery test (e.g. fail →
   retry → succeed). A retry cycle in the spec is a legal loop — test one
   full iteration.
4. **Every boundary handler**: timer → timeout/fake-clock test; error →
   fault injection; message/signal → deliver the event mid-step;
   non-interrupting → assert the main path continues too.
5. **Waiting events**: one test for `on.received`, one for `on.timeout`.
6. **Data-flow assertions**: `get_data_flow` (or inspect JSON) says which
   steps produce and require each context key — assert the value exists at
   each consuming step in integration tests.
7. **Subflow contract**: mock or drive the subflow to each of its final
   outcomes; assert the parent's matching `on:` route.

### E2E tests specifically

Pages + actions ARE the user journey: `route` gives the URL to visit, each
action's `label` names the button/affordance to interact with, transitions
give the expected next screen. Script an E2E test by walking one start→final
path and asserting, at each page step, that the page for its `route` is
shown and its actions are available. One E2E per final outcome plus one per
major error-recovery loop is a solid default; unit/integration tests carry
the per-outcome matrix (rule 2) so E2E count stays small.

### Traceability

Name tests after step and outcome ids from the spec —
`"reserve-slot → conflict → slot-conflict"` — so a failing test points
straight into the YAML, and `logicspec diff` output maps directly onto the
tests that must change. Put the feature id in the describe block.

## The loop

1. `logicspec validate` — spec must be clean before you start.
2. Read the model (`inspect --json` / MCP), build the edge checklist.
3. Implement, mapping each construct per the table above.
4. Write tests per the coverage rules; tick edges off the checklist.
5. Run tests AND `logicspec validate` again. If implementation needs
   behavior the spec lacks, change the spec first (logicspec-authoring),
   validate, re-render, then code — never let them drift.

Worked derivation for a real feature: `references/test-derivation.md`.
