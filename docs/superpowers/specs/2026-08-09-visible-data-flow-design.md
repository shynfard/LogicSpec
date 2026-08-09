# Visible Data Flow — v0.1 Amendment

**Date:** 2026-08-09
**Status:** Approved design
**Amends:** core DSL v0.1 (unreleased — amended in place, no version bump)

## Problem

v0.1 made control flow visible but left data flow invisible: pages silently load data, operation inputs come from nowhere, responses go nowhere. A reader cannot see which API call a page triggers, what the response is, or what happens to it.

## Design

Five additions. All mappings are `name: name` (informal types unchanged); mappings MAY be partial — unmapped fields are unspecified in v0.1.

1. **`http:` on service operations** (optional): `{method: GET|POST|PUT|PATCH|DELETE, path: /...}`. Transport lives on the operation; features keep referencing identity. Path parameters, query strings, headers, status codes: out of scope, tracked in open-questions.

2. **`load:` on page steps** (optional): data fetched on page entry. Contains `call:` (or `endpoint:`), optional `with:`, `into:`, `on-error:` (same semantics as operation steps).

3. **`with:` on operation steps, `load:` blocks, and publish steps** (optional): input mapping `input-or-payload-key: context-key`. Keys MUST match the operation's declared `input` names (or the event's payload names); values MUST match declared context keys.

4. **`into:` on operation steps, `load:` blocks, and wait steps** (optional): output mapping `context-key: output-or-payload-key`. Values MUST match the operation's declared `output` names (or the event's payload names).

5. **`endpoint:` escape hatch** (`{method, url}`) on operation steps and `load:` blocks, for external APIs with no service document. Mutually exclusive with `call:`. Internal services SHOULD use `call:`; a future linter flags `endpoint:` pointing at workspace-owned APIs.

## New diagnostics

- `Unknown input: <service>.<op>.<name>` — `with:` key not in operation input
- `Unknown output: <service>.<op>.<name>` — `into:` value not in operation output
- `Unknown payload field: <Event>.<name>` — wait `into:` / publish `with:` against undeclared payload
- `Unknown context key: <name>` — mapping references undeclared context
- Advisory (future): `endpoint: used for internal service`

## Touched files

`docs/specification.md` (step types, service model, references), `schema/logicspec-0.1.schema.json` (nameMap, httpBinding, endpointBinding, load, with/into), all example services (+`http:`, +`list-services`) and features (+`load:`, `with:`, `into:`), `docs/terminology.md`, `docs/references.md` (diagnostics), `docs/open-questions.md` (+HTTP binding depth), README teaser, validation script (mapping checks).
