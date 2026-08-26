# LogicSpec plugin for Claude Code

Teaches Claude to author, validate and visualize LogicSpec specifications in
any project.

**Contents**

- **Skill `logicspec-authoring`** — the DSL rules (nine step types, transition
  semantics, catalogs, data-flow expectations), the validate-fix-render loop,
  and reference sheets covering the full current language — decision tables,
  typed events (timer/message/signal/error/conditional), boundary handlers,
  agent zones, guarded outcomes, `final.terminate`, `$ref` shared
  definitions — and every LS diagnostic code (LS001–LS404) with its fix.
- **`/logicspec:feature <description>`** — design a new feature spec end to
  end: sketch, write YAML, extend catalogs, validate until clean, render.
- **`/logicspec:check [path]`** — validate the workspace and fix findings by
  LS code.
- **MCP server** — registers `logicspec mcp`, exposing 10 tools:
  `list_features`, `get_feature`, `get_step`, `get_transitions`,
  `get_service_dependencies`, `get_events`, `validate_feature`.
  `validate_feature` returns the same verdict as `logicspec validate` in CI —
  severity overrides applied, workspace-level catalog findings included.

**Requirements:** the `logicspec` CLI on PATH — `npm install -g logicspec`
once published, or from a checkout: `npm install && npm run build && npm link`.
The MCP server silently stays unavailable when the CLI is missing; the skill
and commands then fall back to `npx logicspec`.

**Install**

```
/plugin marketplace add shynfard/LogicSpec
/plugin install logicspec@logicspec
```

Or copy `skills/logicspec-authoring/` into `~/.claude/skills/` (skill only,
no commands/MCP).

The skill also primes Claude for implementation work in repos that carry
specs: read the feature YAML first, validate, never contradict it, update the
spec before changing behavior.
