# Validation

LogicSpec treats diagnostics as a first-class product. Errors are useful to humans, CI pipelines, and AI agents alike: stable codes, precise paths, source positions where available, and "did you mean" suggestions for typos.

## Pipeline

Every feature file passes through the same stages:

```text
YAML source
    ↓  syntax            → LS001
Schema validation (Zod)  → LS002, LS300
    ↓
Structural rules         → LS301, LS302, LS303, LS304
    ↓
Normalized feature model
    ↓
Graph construction
    ↓
Semantic validation      → LS1xx, LS2xx, LS400
```

Each stage is testable in isolation. Cross-file checks (service catalog, event catalog, subflow resolution and contracts, OpenAPI/AsyncAPI references) run only when a workspace config is found; without `logicspec.config.yaml` they are skipped, never guessed.

Catalog-level checks (LS108, LS109, LS403) belong to the *workspace*, not to any one feature — the CLI reports them once per workspace, and `validate --json` lists them under `workspace.diagnostics`.

## Severities

| Severity | Effect |
|----------|--------|
| `error` | validation fails; exit code 1 |
| `warning` | reported; fails only with `--strict` |
| `info` | advisory; never fails |

### Severity overrides

Any code can be promoted, demoted or disabled per workspace in `logicspec.config.yaml`:

```yaml
diagnostics:
  LS200: "error"   # unreachable steps now fail validation
  LS203: "error"   # unproduced requirements too
  LS402: "off"     # unused-actor infos disappear entirely
```

Overrides apply to feature diagnostics and workspace-level diagnostics alike. `"off"` removes the diagnostic; anything else replaces its severity. **Exit codes follow the effective severities** — an info promoted to error fails the build, an error demoted to info does not. Codes themselves are never affected; only presentation and outcome change.

## Diagnostics catalog

Codes are stable and documented. They are never renumbered or reused.

### File-level

| Code | Name | Severity | Meaning |
|------|------|----------|---------|
| LS001 | `YAML_PARSE_ERROR` | error | The file is not valid YAML |
| LS002 | `SCHEMA_ERROR` | error | The document does not match the schema (unknown property, wrong type, unknown step type, bad enum value, malformed duration or identifier) |
| LS003 | `CONFIG_ERROR` | error | `logicspec.config.yaml` is invalid |
| LS004 | `FILE_ERROR` | error | A file or directory could not be read |

### Reference resolution

| Code | Name | Severity | Meaning |
|------|------|----------|---------|
| LS100 | `UNKNOWN_START` | error | `start` points to a nonexistent step |
| LS101 | `UNKNOWN_STEP` | error | A transition targets a nonexistent step |
| LS102 | `UNKNOWN_ACTOR` | error | A step references an undeclared actor |
| LS103 | `UNKNOWN_CONTEXT` | error | `requires`/`produces` references an undeclared context variable |
| LS104 | `UNKNOWN_OPERATION` | error | `call` references a service or operation missing from the service catalog |
| LS105 | `UNKNOWN_EVENT` | error | `event` references an event missing from the event catalog |
| LS106 | `UNKNOWN_SUBFLOW` | error | `flow` references a feature that does not exist in the workspace |
| LS107 | `UNKNOWN_STATE` | error | A page `load.on` outcome targets a state the page does not declare |
| LS108 | `UNKNOWN_OPENAPI_OPERATION` | error | An `openapi` reference names an `operationId` missing from the linked OpenAPI document |
| LS109 | `UNKNOWN_ASYNCAPI_CHANNEL` | error | An `asyncapi` reference names a channel missing from the linked AsyncAPI document |

### Graph analysis

| Code | Name | Severity | Meaning |
|------|------|----------|---------|
| LS200 | `UNREACHABLE_STEP` | **warning** | A step exists but cannot be reached from `start` |
| LS201 | `DEAD_END` | error | A non-terminal step has no outgoing transition |
| LS202 | `CLOSED_LOOP` | error | A cycle has no path to any terminal outcome |
| LS203 | `CONTEXT_NOT_PRODUCED` | **warning** | A required context variable is not produced on every path from `start` (see [Data-flow analysis](#data-flow-analysis)) |

### Step structure

| Code | Name | Severity | Meaning |
|------|------|----------|---------|
| LS300 | `INVALID_FINAL` | error | A final step declares outgoing transitions |
| LS301 | `INVALID_TRANSITIONS` | error | `next` and `on` used together on an operation or subflow |
| LS302 | `INVALID_EVENT_STEP` | error | Event direction contradicts its transition properties |
| LS303 | `EMPTY_DECISION` | error | A decision has neither cases nor a default |
| LS304 | `EMPTY_PARALLEL` | error | A parallel step has no branches |

### Advisory

| Code | Name | Severity | Meaning |
|------|------|----------|---------|
| LS400 | `NO_FAILURE_OUTCOME` | **info** | The feature declares no failure outcome (no `final` with `outcome: failure` and no terminal error) |
| LS401 | `UNUSED_CONTEXT` | **info** | A declared context variable is never required or produced |
| LS402 | `UNUSED_ACTOR` | **info** | A declared actor is never assigned to a step |
| LS403 | `OPENAPI_MISMATCH` | **warning** | An http operation's `method`/`path` disagree with the linked OpenAPI operation |
| LS404 | `SUBFLOW_OUTCOME_MISMATCH` | **warning** | A subflow `on:` outcome does not match any final outcome of the target feature (needs a workspace) |

## Data-flow analysis

LS203 is a **must-availability** analysis: a context variable counts as available at a step only when it is produced on *every* path from `start` to that step (set intersection at joins, computed to a fixpoint — cycles are handled). Checked requirements are page `requires`, page-action `requires`, and operation/subflow `requires`.

Two deliberate properties:

* **Approximation.** `produces` of an operation or subflow is assumed to hold on *all* of its outcomes, including error paths. This can only hide findings (false negatives), never invent them — every reported LS203 corresponds to a real path on which nothing produced the variable.
* **Unreachable steps are never reported.** Their availability is unknowable; LS200 already covers them.

Legitimate retry loops do not trigger LS203: on re-entry, availability is what the *initial* entry guarantees, which is exactly the question being asked.

## Loops: valid and invalid

Cycles are a normal part of feature logic. This is **valid**:

```text
Select Time → Reserve Slot —conflict→ Slot Conflict —choose another→ Select Time
```

The loop can always escape through `Reserve Slot`'s `success` outcome.

What LS202 rejects is a **trapped** region: a strongly connected group of steps, reachable from `start`, from which **no path leads to any terminal**. Terminals are `final` steps and `error` steps without recovery actions. Legitimate retry loops always have an exit, so they never trigger LS202.

## Suggestions

Typo-like errors (unknown step, actor, context variable, service, operation, event, subflow, state, step type) include a nearest-name suggestion when a close match exists:

```text
LS101 ERROR UNKNOWN_STEP
  file: features/booking.feature.yaml:104:9
  at:   steps.reserve-slot.on.success.next
  Step "reserve-slot" transitions to unknown step "chekout". Did you mean "checkout"?
```

The edit-distance budget scales with name length, so short names never produce absurd suggestions.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | valid / success |
| 1 | validation errors (or warnings with `--strict`) |
| 2 | parsing, configuration, or usage errors (unreadable file, broken YAML, invalid config, bad flags) |

## Machine-readable output

`logicspec validate --json` prints one stable JSON object instead of text:

```json
{
  "valid": false,
  "files": [
    { "file": "features/checkout.feature.yaml", "valid": false, "diagnostics": [], "stats": {} }
  ],
  "workspace": { "diagnostics": [] },
  "summary": { "files": 2, "errors": 1, "warnings": 0, "info": 1 }
}
```

Exit codes are identical to the text mode, so CI can consume either.

## Diagnostics are data

The library returns `Diagnostic[]` — code, name, severity, message, file, document path, source position (with `endLine`/`endColumn` when resolvable, so editors can underline exact ranges), suggestion. It never prints. The CLI is one presentation of diagnostics; editors, CI annotations, and agents are others.
