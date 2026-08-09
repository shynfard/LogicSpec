# Terminology

Glossary of LogicSpec terms. Normative definitions live in [specification.md](specification.md); this page is the quick reference.

**Workspace** — the unit of a LogicSpec project: one root manifest plus every LogicSpec document discovered below it. See [workspaces.md](workspaces.md).

**Root manifest** — the single `logicspec.yaml` file at the workspace root. Configuration only; never contains derived state.

**LogicSpec document** — a YAML file matching `*.logic.yaml` (or the root manifest) with a `logicSpec` version, a `kind`, and one body. Documents may live anywhere below the workspace root.

**Document kind** — what a document defines: `workspace`, `module`, `feature`, `service`, or `events` in v0.1.

**Module** — a logical application area (booking, payment, notification). Defined by a `module` document; other documents join it via the `module:` envelope key. See [modules.md](modules.md).

**Module membership** — the association between a feature/service/events document and a module, declared with `module: <module-id>`.

**Feature** — a user-facing flow defined as named steps with transitions, starting at `start` and ending in outcomes.

**Step** — one named state within a feature. Steps reference each other by step ID within the same feature.

**Step type** — the behavior class of a step. v0.1 has exactly six: `page`, `operation`, `decision`, `publish`, `wait`, `outcome`.

**Page** — a step presenting a UI state to an actor, with named actions leading to other steps.

**Operation (step)** — a step calling a service operation via `call: <service-id>.<operation-id>`, routing success and declared errors.

**Decision** — a step branching on a business condition (prose `when` in v0.1) into named branches.

**Publish** — a step emitting an event.

**Wait** — a step suspending the flow until an event arrives; the v0.1 primitive for asynchronous workflows.

**Outcome** — a terminal step, optionally classified `success`, `failure`, or `cancelled`.

**Actor** — who drives a feature (customer, staff, system). Named but not further defined in v0.1.

**Context** — named data carried through a feature's flow. Informal type names in v0.1. Mappings (`with:`, `into:`) validate against these names.

**Load** — the optional `load:` on a page step declaring what data is fetched when the page is entered and where each response goes. One block or a list of independent blocks (no ordering defined; tooling may fetch in parallel).

**Wait-for-any** — the `events:` form of a wait step: the flow resumes on whichever listed event arrives first, each with its own mapping and target step.

**Mapping** — a `name: name` pairing connecting context to operation inputs/outputs or event payloads: `with:` (context → input/payload), `into:` (output/payload → context). Mappings may be partial.

**HTTP binding** — the optional `http:` block (`method`, `path`) on a service operation. Transport detail lives on the operation, never in features.

**Endpoint (escape hatch)** — the `endpoint:` block (`method`, `url`) on an operation step or load block, for external APIs that have no service document. Internal services use `call:`.

**Service** — a backend component exposing named operations. Defined by a `service` document.

**Operation (service)** — a named capability of a service with optional input, output, declared errors, and published events.

**Event** — a named fact (PascalCase) published and consumed across modules. Defined in `events` documents.

**Identity** — a document or element's ID. Identity, never file location, is what references resolve against. See [references.md](references.md).

**Reference** — an identity-based link between documents: `module:`, `call:`, `event:`, or a step target.

**Discovery** — the process of locating all LogicSpec documents under a workspace root using the manifest's include/exclude globs. See [discovery.md](discovery.md).

**Workspace index** — the derived, in-memory model of all discovered documents, their identities, references, source locations, and relationships. Never committed, never written back into YAML.

**Diagnostic** — a problem report from tooling (unknown module, duplicate ID, unreachable step, …) pointing at a source range. Cataloged in [references.md](references.md).
