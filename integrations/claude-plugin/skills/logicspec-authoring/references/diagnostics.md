# LS diagnostics — meaning and fix

Codes are stable. Bands: 0xx file, 1xx references, 2xx graph, 3xx structure,
4xx advisory. Severities can be overridden per workspace via
`logicspec.config.yaml` → `diagnostics:` (`error|warning|info|off`); exit
codes follow the effective severities.

| Code | Severity | Meaning | Fix |
|------|----------|---------|-----|
| LS001 | error | YAML syntax broken | fix the syntax at the reported line |
| LS002 | error | schema violation / unknown property or step type | follow the message; check spelling against the reference |
| LS003 | error | invalid logicspec.config.yaml | fix the config keys/values |
| LS004 | error | file unreadable | fix the path/permissions |
| LS005 | error | config-referenced path (catalog, openapi/asyncapi document, features dir) escapes the workspace root | keep every path inside the directory containing logicspec.config.yaml; no absolute paths or `..` |
| LS100 | error | `start` points to a missing step | point at an existing step id |
| LS101 | error | transition targets a missing step | use the suggested id or add the step |
| LS102 | error | undeclared actor | declare under `actors:` or fix the name |
| LS103 | error | undeclared context variable | declare under `context:` or fix the name |
| LS104 | error | unknown service/operation in `call:` | add it to services.yaml or fix the ref |
| LS105 | error | unknown event name (event step or message/signal boundary) | add it to events.yaml or fix the name |
| LS106 | error | unknown subflow `flow:` | create the feature or fix the id |
| LS107 | error | page `load.on` targets undeclared state | add the state to `states:` or fix it |
| LS108 | error | openapi ref: operationId not in document | fix operationId or the OpenAPI doc |
| LS109 | error | asyncapi ref: channel not in document | fix channel or the AsyncAPI doc |
| LS110 | error | `$ref` target definition does not exist (or no definitions catalog configured) | add it to definitions.yaml, fix the name (see suggestion), or set `catalogs.definitions` |
| LS111 | error | `$ref` malformed, or wrong section (actor slot → step or vice versa) | write exactly `definitions#/actors/<name>` or `definitions#/steps/<name>`, matching the slot |
| LS112 | error | definition `$ref` cycle, chain deeper than 100 links, or expansion over the 5 MB budget | break the cycle, flatten the chain, or shrink the fanned-out template |
| LS113 | warning | a step's `details` entry names a flow that doesn't exist in the workspace | fix the flow name (suggestion given), create the feature, or drop the link — `details` is documentation, nothing is invoked |
| LS200 | warning | step unreachable from start | connect it or delete it |
| LS201 | error | non-terminal step has no outgoing transition | add `next`/`on`/an action, or end in a `final` |
| LS202 | error | loop with no path to any terminal | give the cycle an exit toward a final/terminal error |
| LS203 | warning | `requires` not produced on every path from start | add `produces` on the producing action/operation, or reroute the missing path |
| LS300 | error | `final` has outgoing transitions | remove them; finals end the flow |
| LS301 | error | both `next` and `on` on one step | keep exactly one |
| LS302 | error | event direction/property mismatch | publish→`next`; wait→`on.received` (+`on.timeout`) |
| LS303 | error | decision with no case, no decision table and no default | add at least one |
| LS304 | error | parallel with no branches | add a branch or remove the step |
| LS305 | error | event fields contradict `eventKind` (or required field blank) | timer: exactly one of `after`/`at`/`every` + `direction: wait`; message/signal/untyped: name an `event`; conditional: set `when` + wait; error: optional non-blank `name`; drop fields belonging to other kinds |
| LS306 | error | `when` guard present but blank (operation/subflow outcome or page action) | write the guard text or remove `when` |
| LS307 | error | invalid decision table | don't combine with `cases`; ≥1 output column and ≥1 rule; match each rule's `when`/`then` width to inputs/outputs; at most one reserved `next` column with non-blank cells (no `next` column requires a `default`); stay under 1000 rules / 50 columns / 500-char cells |
| LS308 | error | invalid boundary handler | attach only to page/subflow/parallel; match fields to the handler's `eventKind` (timer: one of `after`/`at`/`every`; message/signal: `event`; conditional: `when`; error: optional `name`); ≤1000 handlers/step, ≤500-char fields |
| LS309 | error | invalid agent zone | reference existing steps only, keep each step in at most one zone, name ≥1 step; ≤100 zones/feature, ≤1000 steps/zone, ≤200-char label, ≤1000-char description |
| LS400 | info | no failure outcome declared | consider a `final` with `outcome: failure` or a terminal error |
| LS401 | info | context variable never used | wire it into `requires`/`produces` or delete it |
| LS402 | info | actor never assigned to a step | assign it or delete it (workspaces often `off` this) |
| LS403 | warning | http method/path disagree with linked OpenAPI op | align the catalog with the OpenAPI document |
| LS404 | warning | subflow `on` key not a final outcome of the target | use the target's real outcomes (see suggestion) |

Catalog-level findings (LS108/LS109/LS403) are reported once per workspace,
against the catalog file — `validate --json` lists them under
`workspace.diagnostics`, not per feature. LS110/LS111/LS112 are also raised
at catalog load for broken definitions no feature references yet.
