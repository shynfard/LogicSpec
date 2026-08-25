# Publishing & releases

How a LogicSpec release reaches npm, the VS Code Marketplace, and Obsidian
users. Publishing is always tag-driven and always behind a **manual** CI job —
no push ever publishes by itself.

## Release flow

1. Bump `version` in `package.json` (and in
   `integrations/vscode/package.json`, `integrations/obsidian/manifest.json` +
   `versions.json` when those change).
2. Update `CHANGELOG.md`.
3. Run the full gate locally: `npm run typecheck && npm run lint && npm run build && npm test`.
4. Commit, tag `vX.Y.Z` (must match `package.json` — the publish job enforces
   this), push the tag.
5. In the GitLab pipeline for the tag, trigger the manual jobs you want:
   `publish-npm`, `publish-vscode`, optionally `publish-openvsx`.

## CI configuration

`.gitlab-ci.yml` defines the pipeline. Required CI/CD variables
(Settings → CI/CD → Variables, **masked + protected**):

| Variable | Used by | Notes |
|----------|---------|-------|
| `NPM_TOKEN` | `publish-npm` | npm automation token. The package name `logicspec` was unclaimed on npm as of 2026-08-10; the first publish claims it. |
| `VSCE_PAT` | `publish-vscode` | Azure DevOps personal access token for the Marketplace publisher. |
| `OVSX_PAT` | `publish-openvsx` | Optional Open VSX token (VSCodium/Gitpod users). |

GitHub Actions (`.github/workflows/ci.yml`) stays test-only; publishing lives
in GitLab.

## Per-target notes

### npm (`logicspec`)

- `files` allowlists `dist`, `schemas`, `README.md`, `CHANGELOG.md`,
  `LICENSE`; `prepack` builds, `prepublishOnly` re-runs the full gate.
- `publishConfig.access: public`.
- The `logicspec/core` subpath export ships in the same package.
- Consumers get the CLI as the `logicspec` bin.

### VS Code extension

- The `vsix` job builds `logicspec-vscode-vX.Y.Z.vsix` as a pipeline
  artifact — installable via "Install from VSIX…" without any marketplace.
- Marketplace publishing requires a one-time, manual publisher account whose
  id matches `publisher` in `integrations/vscode/package.json` (set to
  `Shynfard`). The account lives on Azure DevOps; corporate tenants often
  block PAT creation, so use a personal Microsoft account for it.
- **No PAT? Two PAT-free marketplace paths.** Creating the *publisher* is a
  plain signed-in web form (no token) at
  https://marketplace.visualstudio.com/manage — required once in every path.
  Then either:
  1. **Manual web upload**: publisher page → "+ New extension" →
     "Visual Studio Code" → upload the `.vsix` (the vsix's `publisher`
     field must match the publisher id, or the upload is rejected).
     Updates work the same way via the extension's "…" → Update.
  2. **Azure CLI auth**: `az login` with the publisher's account, then
     `npx @vscode/vsce publish --azure-credential --packagePath <file>.vsix`
     — vsce takes an Entra token from the az session instead of a PAT.
- **No Azure account at all?** Use the GitHub `Release` workflow's
  `github-release` target instead: it attaches the `.vsix` and the Obsidian
  plugin zip to the tag's GitHub Release ("Install from VSIX…").
  Open VSX (`publish-openvsx`) also needs no Azure — GitHub login plus the
  Eclipse publisher agreement.
- `--no-dependencies` is correct: esbuild bundles the core into the extension.

### Obsidian plugin

- The `obsidian-plugin` job produces the drop-in folder
  (`main.js`, `manifest.json`, `styles.css`) as a pipeline artifact. Users
  copy it to `<vault>/.obsidian/plugins/logicspec/` or install via BRAT.
- Listing in the community plugin directory is a separate, manual process:
  a public GitHub repository with tagged releases carrying those three files,
  plus a PR to `obsidianmd/obsidian-releases`. Do this only after the final
  public name is settled.

## Renaming before first publish

The working name `logicspec` is not final. Before the FIRST npm publish,
decide the public name; changing it later is a breaking event for every
consumer. Rename checklist: `package.json` `name` + bin entry, README,
`$id` URLs in `schemas/*.schema.json` (regenerate), the VS Code
`publisher`/`name`, the Obsidian `manifest.json` id, and MCP registration
snippets in the docs.
