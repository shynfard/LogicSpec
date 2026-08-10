# LogicSpec for VS Code

> **EXPERIMENTAL** — developed in-repo, not published to the marketplace.

Diagnostics and a live Mermaid preview for [LogicSpec](../../README.md) feature
specifications.

## Features

- **Diagnostics as you type** for `*.feature.yaml`, `services.yaml`,
  `events.yaml` and `logicspec.config.yaml` (300 ms debounce). Full LogicSpec
  validation — schema, structure, references against the surrounding
  workspace's catalogs, graph analysis — with `LS###` codes, precise ranges
  and "did you mean" suggestions.
- **Live preview** (`LogicSpec: Preview Feature`, or the editor-title button on
  feature files): renders the current feature as a Mermaid diagram beside the
  editor and re-renders on every change. An invalid spec never replaces the
  last good diagram — a banner appears instead.
- **`LogicSpec: Validate Workspace`**: validates every feature file in the
  workspace and reports a summary.
- Preview view is configurable: `logicspec.preview.view` —
  `flow` (default), `swimlane`, `sequence`, `event-model`.

## Development

```bash
cd integrations/vscode
npm install
npm run build        # bundles dist/extension.cjs + copies mermaid into media/
```

Open this folder in VS Code and press **F5** (launch config included) to start
an Extension Development Host. Use `npm run watch` for rebuild-on-save; reload
the dev host window to pick up changes.

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (pure modules: mapping, debounce)
```

The extension bundles the LogicSpec core **from source** (`../../src`) via an
esbuild alias — no root build is required.

## Packaging

```bash
npx @vscode/vsce package
```

produces a `.vsix` you can install via *Extensions: Install from VSIX…*.

## Notes

- The Mermaid browser bundle is copied from the `mermaid` npm package into
  `media/mermaid.min.js` at build time and rendered inside a CSP-restricted
  webview (`securityLevel: "strict"`).
- Config file diagnostics reflect the saved on-disk state.
