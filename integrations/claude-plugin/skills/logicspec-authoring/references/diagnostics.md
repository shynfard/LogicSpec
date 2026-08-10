# LS diagnostics — meaning and fix

Codes are stable. Bands: 0xx file, 1xx references, 2xx graph, 3xx structure,
4xx advisory. Severities can be overridden per workspace via
`logicspec.config.yaml` → `diagnostics:` (`error|warning|info|off`).

| Code | Severity | Meaning | Fix |
|------|----------|---------|-----|
| LS001 | error | YAML syntax broken | fix the syntax at the reported line |
| LS002 | error | schema violation / unknown property or step type | follow the message; check spelling against the reference |
| LS003 | error | invalid logicspec.config.yaml | fix the config keys/values |
| LS004 | error | file unreadable | fix the path/permissions |
| LS100 | error | `start` points to a missing step | point at an existing step id |
| LS101 | error | transition targets a missing step | use the suggested id or add the step |
| LS102 | error | undeclared actor | declare under `actors:` or fix the name |
| LS103 | error | undeclared context variable | declare under `context:` or fix the name |
| LS104 | error | unknown service/operation in `call:` | add it to services.yaml or fix the ref |
| LS105 | error | unknown event name | add it to events.yaml or fix the name |
| LS106 | error | unknown subflow `flow:` | create the feature or fix the id |
| LS107 | error | page `load.on` targets undeclared state | add the state to `states:` or fix it |
| LS108 | error | openapi ref: operationId not in document | fix operationId or the OpenAPI doc |
| LS109 | error | asyncapi ref: channel not in document | fix channel or the AsyncAPI doc |
| LS200 | warning | step unreachable from start | connect it or delete it |
| LS201 | error | non-terminal step has no outgoing transition | add `next`/`on`/an action, or end in a `final` |
| LS202 | error | loop with no path to any terminal | give the cycle an exit toward a final/terminal error |
| LS203 | warning | `requires` not produced on every path from start | add `produces` on the producing action/operation, or reroute the missing path |
| LS300 | error | `final` has outgoing transitions | remove them; finals end the flow |
| LS301 | error | both `next` and `on` on one step | keep exactly one |
| LS302 | error | event direction/property mismatch | publish→`next`; wait→`on.received` (+`on.timeout`) |
| LS303 | error | decision with no case and no default | add at least one |
| LS304 | error | parallel with no branches | add a branch or remove the step |
| LS400 | info | no failure outcome declared | consider a `final` with `outcome: failure` or a terminal error |
| LS401 | info | context variable never used | wire it into `requires`/`produces` or delete it |
| LS402 | info | actor never assigned to a step | assign it or delete it (workspaces often `off` this) |
| LS403 | warning | http method/path disagree with linked OpenAPI op | align the catalog with the OpenAPI document |
| LS404 | warning | subflow `on` key not a final outcome of the target | use the target's real outcomes (see suggestion) |

Catalog-level findings (LS108/LS109/LS403) are reported once per workspace,
against the catalog file — not per feature.
