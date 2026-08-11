# LogicSpec Vision — from toolchain to platform

> What we want to achieve, across all planned versions. The org lives at
> [github.com/LogicSpec-io](https://github.com/LogicSpec-io); this document is the
> single reference each repo's work starts from. Status: living document.

## Thesis

Spec-driven development is becoming the default way to build with AI agents — and its
documented failure modes (spec drift misleading agents, verbose prose nobody re-reads,
non-deterministic implementations) are all **validation problems**. Validation needs
structure. LogicSpec's bet: **machine-checkable specs beat markdown prose.** A typed
YAML DSL with stable diagnostics (LS codes), graph reachability and dataflow checks,
deterministic rendering, and semantic diff turns "did the spec drift?" from a feeling
into a failing check.

The moat is the validator, not the canvas. Every product surface below exists to put
the validator into more loops: the PR loop, the editing loop, the agent loop, the
discovery loop.

## What exists today

The core toolchain (this repo, npm [`logicspec`](https://www.npmjs.com/package/logicspec),
Apache-2.0): parse → validate → normalize → graph → render (Mermaid: flow / swimlane /
sequence / event-model) → inspect / diff / edit, an MCP server, a VS Code extension with
an interactive React Flow canvas, and an experimental browser editor. Specs link to
OpenAPI/AsyncAPI catalogs. Nothing in a spec ever executes — LogicSpec is a design
tool, not a workflow engine.

## Milestones

Each milestone is **evidence-gated**: the next one starts when the current one's gate
is met, not when the calendar says so.

### M0 — Drift gate (repo: [`logicspec-action`](https://github.com/LogicSpec-io/logicspec-action))

The validator in every PR. A GitHub Action that discovers `features/**/*.feature.yaml`,
runs `validate --strict` and semantic `diff` against the base branch, posts one PR
comment (diagnostics table + diff + Mermaid flow; check-run fallback for fork PRs),
and fails the check on errors. Plus a bootstrap recipe so a user's own AI agent
generates their first spec, and a landing page at logicspec.io.

*Gate:* stranger installs and repos with the check cycling green/red.

### M1 — Platform CE, self-hosted (repo: [`platform`](https://github.com/LogicSpec-io/platform))

An open-source, self-hostable app — one Docker image, SQLite/Postgres:

- **Connect git** (PAT-first, optional own GitHub App), pick repo + branch →
  auto-discovery of features, service and event catalogs. Manual catalog editing for
  greenfield projects. AI-inferred suggestions from code are always labeled
  "suggested — unverified" and never merge without confirmation.
- **Interactive canvas** — click-only visual editing, palette limited to the nine
  step types, validation-aware guardrails. Shared editor components with the VS Code
  extension (published package, one canvas implementation).
- **Two-way write-back** — comment/format-preserving YAML mutations, committed as
  branches/PRs. Git owns the truth; the platform DB stores only operational state
  (sessions, encrypted tokens, caches) — dropping it never loses spec content.
- **MCP endpoint** — agents connect to the project over Streamable HTTP with a
  project token.
- **AI, bring-your-own key** — free in CE forever; CE has no artificial limits.

Open core: everything outside `ee/` is free (AGPL-3.0 proposed); `ee/` holds
commercial features under a separate license, gated by a signed license key.

*Gate:* external self-host deployments + a team asking for hosted.

### M2 — Cloud (repos: `platform/ee`, private [`cloud`](https://github.com/LogicSpec-io/cloud))

The hosted product at app.logicspec.io: multi-tenant orgs and roles, spec review flow
(propose → semantic diff → approve → merge PR), hosted git for teams without a remote,
managed AI in a monthly subscription (included quota, hard cap, no surprise bills),
Stripe billing. All app code stays public in `platform/ee`; the private `cloud` repo
holds only IaC, deploy config, and secrets. Minimal infra: one Postgres, one app.

*Gate:* paying teams; and ≥20 external spec authors unlocks M3.

### M3 — Hub (repo: [`hub`](https://github.com/LogicSpec-io/hub))

A public spec registry, Artifact Hub model — metadata-only, links back to source:

- `logicspec.io/specs/{gh|gl}/{org}/{repo}/{folder}` — a published spec is one
  self-contained spec folder (features + catalogs + workspace config), validated
  with `logicspec validate --publishable`.
- Login exclusively via GitHub/GitLab OAuth; connect a repo, spec folders are
  auto-discovered, versions derived from git tags. Validate badge per spec; spec
  pages render all views and the dependency graph.

## Organization map

| Repo | Role | License | When |
|---|---|---|---|
| `logicspec` | Core toolchain (this repo; transfer into the org planned) | Apache-2.0 | shipped |
| `website` | logicspec.io — landing + docs (docs sourced from this repo) | Apache-2.0 | now |
| `logicspec-action` | PR drift gate | Apache-2.0 | M0 |
| `platform` | Self-host CE + `ee/` commercial | AGPL-3.0 proposed | M1 |
| `cloud` | IaC/secrets for app.logicspec.io — zero app code | private | M2 |
| `hub` | Public spec registry | AGPL-3.0 proposed | M3 |

## Principles

1. **Git owns the truth.** Specs live in the user's repository; every platform layer
   is a view or a gate over git, never a silo.
2. **Validation is the hero.** Any surface that shows a spec also shows its
   diagnostics; anything that edits a spec cannot produce an invalid one silently.
3. **Deterministic output.** Same YAML, same render, byte-identical — everywhere,
   including the platform and hub.
4. **Agents are first-class users.** MCP everywhere the human UI goes.
5. **Evidence before infrastructure.** Every milestone has a gate and a miss-path;
   the hub waits for an ecosystem, billing waits for demand.
6. **Open core, honestly split.** Free means free (CE unlimited); commercial code is
   public and key-gated; only deployment secrets are private.

## Open questions

Pricing model (per-seat vs per-project), AGPL vs Apache for the platform CE,
hosted-git implementation, the exact UX quarantine for AI-inferred catalog
suggestions, and the "LogicSpec" trademark search — tracked as they resolve.
