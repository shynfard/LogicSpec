# shared — `$ref` definitions

This workspace demonstrates LogicSpec's shared-definitions mechanism: a
`definitions.yaml` catalog of reusable actors and step templates that features
pull in with `$ref`.

## How it works

`logicspec.config.yaml` points the workspace at the catalog:

```yaml
catalogs:
  definitions: ./definitions.yaml
```

`definitions.yaml` declares two kinds of reusable pieces:

- **Actors** (`actors:`) — complete actor definitions.
- **Step templates** (`steps:`) — a step body *without* an id and *without* an
  outgoing transition; each caller supplies both.

A feature references them with `definitions#/actors/<name>` or
`definitions#/steps/<name>`, and may add local keys that shallow-merge over the
resolved definition (local wins). In `reminder.feature.yaml`:

```yaml
actors:
  notifier:
    $ref: "definitions#/actors/notifier"
    label: Reminder Notifier        # local override

steps:
  notify:                            # the map key becomes the step id
    $ref: "definitions#/steps/send-notification"
    label: Send Reminder             # local override
    next: sent                       # the transition the template left open
```

References are expanded at parse time (`src/parser/expand-refs.ts`), *before*
schema validation, so the merged result is still checked against the strict
actor/step schemas. Nothing is executed. Bad references are reported as
LS110 (unknown target), LS111 (malformed `$ref`) or LS112 (reference cycle).

```bash
node dist/cli/main.js validate examples/shared
```
