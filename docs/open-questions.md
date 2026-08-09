# Open Questions

Design questions deliberately left unresolved in v0.1. Each entry records context, options, and the current lean. Resolving one requires updating [specification.md](specification.md) and, where relevant, the [JSON Schema](../schema/logicspec-0.1.schema.json).

## 1. Identifier namespacing

**Context:** v0.1 requires module, feature, service, and event IDs to be unique across the whole workspace ([references.md](references.md#uniqueness)). Large workspaces may want scoped IDs.

**Options:**
- Keep global uniqueness (simple, unambiguous references).
- Module-scoped IDs (`booking/create`, `payment/create`) with scoped reference syntax.

**Current lean:** keep global uniqueness until a real workspace hits collisions. Do not invent namespace semantics prematurely.

## 2. Nested workspaces

**Context:** should a workspace be allowed to contain another independent `logicspec.yaml`?

**Options:**
- Forbid entirely.
- Allow with explicit nested-boundary support in tooling (inner workspace excluded from outer discovery).

**Current lean:** a workspace SHOULD NOT contain another independent workspace unless tooling explicitly supports nested boundaries.

## 3. Multi-root editor workspaces

**Context:** VS Code supports multiple workspace folders; the initial extension assumes one `logicspec.yaml` per folder.

**Current lean:** implementation-stage decision for Phase 2. Do not complicate the language for it.

## 4. External modules and imports

**Context:** future versions may support modules from outside the workspace:

```yaml
imports:
  authentication:
    source: git
```

or packaged LogicSpec libraries.

**Current lean:** future work only. No import syntax exists in v0.1, and none should be designed until the single-workspace model is proven.

## 5. Context and data typing depth

**Context:** `context`, operation `input`/`output`, and event `payload` use informal type names in v0.1 (`slot: Slot`, `bookingId: string`).

**Options:**
- Stay informal (types are documentation).
- Introduce an `entities` document kind with structured type definitions that references validate against.

**Current lean:** stay informal in v0.1; `entities` is a reserved future kind ([specification.md](specification.md#document-kinds)).

## 6. Decision conditions and expressions

**Context:** `when:` on decision steps is prose. Generation (Phase 5) may need machine-evaluable conditions.

**Current lean:** prose in v0.1. Revisit when generation demands it; any expression language must not make specs unreadable to non-programmers.

## 7. Step-type extensibility

**Context:** the six step types are a closed set in v0.1.

**Options:**
- Keep closed, extend only via spec versions.
- Allow tool-defined or user-defined step types with an extension marker.

**Current lean:** closed set. Predictability for tooling and agents outweighs flexibility at this stage.

## 8. HTTP binding depth

**Context:** service operations may carry an `http:` binding (`method`, `path`), and operation steps may use the `endpoint:` escape hatch for external APIs. v0.1 deliberately stops there: no path parameters, query strings, headers, status-code mapping, or auth.

**Options:**
- Keep bindings shallow (transport detail belongs to generators).
- Grow toward a fuller HTTP description (path templates like `/bookings/{id}`, status → error mapping).
- Defer richer API description to a future `integration` document kind.

**Current lean:** stay shallow. The binding exists for navigation, hover, and generation hints — not to replace OpenAPI. Revisit when Phase 5 generation needs more. Related: should a future linter flag `endpoint:` used against workspace-owned services?

## 9. Timeout semantics on `wait`

**Context:** `timeout:` names a target step but no duration; durations, retries, and escalation are undefined.

**Current lean:** target-only in v0.1. Duration syntax arrives no earlier than the first executable consumer (Phase 4/5) that needs it.
