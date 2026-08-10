# LogicSpec for Obsidian

> **EXPERIMENTAL** — functional, but APIs and rendering details may change.
> Not yet submitted to the Obsidian community plugin store.

Render and validate [LogicSpec](../../README.md) feature specifications as
Mermaid diagrams inside Obsidian notes. The YAML stays the source of truth;
the diagram is always derived, never stale: an invalid specification shows
its diagnostics instead of a diagram.

## What you get

### Inline specifications — ` ```logicspec `

Put a complete feature document in a `logicspec` code block:

````markdown
```logicspec
version: "1"
feature:
  id: login
  name: Login
start: login-page
steps:
  login-page:
    type: page
    actions:
      submit:
        next: done
  done:
    type: final
    outcome: success
```
````

Reading view renders the validated Mermaid diagram (view and direction from
the plugin settings) with any warnings/infos listed underneath. Errors
(unknown steps, dead ends, …) replace the diagram with the diagnostics list —
severity badge, `LS` code, `line:column`, message.

### Referenced files — ` ```logicspec-file `

Keep specs as real `*.feature.yaml` files in your vault and embed them:

````markdown
```logicspec-file
file: features/booking.feature.yaml
view: swimlane        # optional: flow | swimlane | sequence | event-model
direction: LR         # optional: TD | TB | LR | RL | BT
```
````

The diagram re-renders automatically when the referenced file changes in the
vault.

### Command

**LogicSpec: Insert feature diagram block** inserts a `logicspec-file`
template at the cursor.

### Settings

Default view and default direction, used whenever a block does not override
them.

## Install (manual)

1. Build the plugin:

   ```bash
   cd integrations/obsidian
   npm install
   npm run build
   ```

2. Copy the contents of `dist/` (`main.js`, `manifest.json`, `styles.css`)
   into `<your vault>/.obsidian/plugins/logicspec/`.

3. Reload Obsidian and enable **LogicSpec** under *Community plugins*.

Alternatively, [BRAT](https://github.com/TfTHacker/obsidian42-brat) can
install straight from a repository once this project has a public home.

Requires Obsidian **1.4.0+** (the plugin renders through Obsidian's bundled
Mermaid via `loadMermaid()`; no Mermaid is shipped in the bundle).

## Notes

- Validation runs file-locally: catalog-dependent checks (unknown service
  operations, unknown events, subflow resolution) don't apply inside
  Obsidian — run `logicspec validate` in the workspace for the full set.
- The LogicSpec core is bundled from `../../src` at build time; no root
  build is required.
