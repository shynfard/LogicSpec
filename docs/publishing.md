# Publishing & releases

How a LogicSpec release reaches npm, the VS Code Marketplace, and Obsidian
users. Publishing is always tag-driven and always behind a **manual** CI job —
no push ever publishes by itself.

The package is live on npm as
[`logicspec`](https://www.npmjs.com/package/logicspec) and the extension on the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Shynfard.logicspec-vscode).
npm publishes carry **provenance** (GitHub OIDC) via the GitHub `Release`
workflow, linking each published version to this repository and the exact
workflow run that built it.

## Version lockstep

Versions are locked across the root package and every integration
(`integrations/vscode`, `integrations/editor`, `integrations/obsidian`,
`integrations/claude-plugin` — including the Obsidian `manifest.json` +
`versions.json` and the plugin's `.claude-plugin/plugin.json`). A release bumps
**all of them to the same X.Y.Z**, and CI enforces it:
`npm run check:versions` (`scripts/check-versions.mjs`) fails the pipeline on
any drift. Release tags must be `vX.Y.Z` matching that version — the publish
jobs refuse anything else.

## Release flow

1. Bump `version` everywhere in lockstep (see above); verify with
   `npm run check:versions`.
2. Update `CHANGELOG.md`.
3. Run the full gate locally: `npm run typecheck && npm run lint && npm run build && npm test`.
4. Commit, tag `vX.Y.Z` (must match `package.json` — the publish jobs enforce
   this), push the tag.
5. In the GitHub Actions tab, run the **Release** workflow on that tag once per
   target you want: `npm`, `vscode-marketplace`, `github-release`, or
   `vsix-artifact`.

## CI configuration

`.github/workflows/release.yml` defines the publish jobs
(`workflow_dispatch` with a `target` choice; run it from the Actions tab on the
release tag). Required repository secrets:

| Secret | Used by | Notes |
|--------|---------|-------|
| `NPM_TOKEN` | `publish-npm` (target `npm`) | npm automation token for the `logicspec` package. The publish runs `npm publish --access public --provenance` behind the `npm` environment, after a tag-matches-`package.json` guard and the full gate. |
| `VSCE_PAT` | `publish-vscode` (target `vscode-marketplace`) | Azure DevOps personal access token for the Marketplace publisher, behind the `vscode-marketplace` environment. |

Two targets need no secrets: `vsix-artifact` builds the `.vsix` as a
90-day workflow artifact, and `github-release` attaches the `.vsix` and the
Obsidian plugin zip to the tag's GitHub Release (using the built-in
`github.token`).

`.github/workflows/ci.yml` stays test-only (it also runs the version-lockstep
and doc-drift checks). `.gitlab-ci.yml` mirrors the pipeline for the GitLab
remote; the canonical publish path is the GitHub `Release` workflow, since
that is where npm provenance comes from.

## Per-target notes

### npm (`logicspec`)

- Published as `logicspec` (latest 0.13.0, next 0.14.0), with provenance.
- `files` allowlists `dist`, `schemas`, `README.md`, `CHANGELOG.md`,
  `LICENSE`; `prepack` builds, `prepublishOnly` re-runs the full gate.
- `publishConfig.access: public`.
- The `logicspec/core` subpath export ships in the same package.
- Consumers get the CLI as the `logicspec` bin.

### VS Code extension

- The `vsix-artifact` target builds `logicspec-vscode.vsix` as a workflow
  artifact — installable via "Install from VSIX…" without any marketplace.
- Marketplace publishing uses the publisher whose id matches `publisher` in
  `integrations/vscode/package.json` (set to `Shynfard`). The account lives on
  Azure DevOps; corporate tenants often block PAT creation, so use a personal
  Microsoft account for it.
- **No PAT? Two PAT-free marketplace paths.** The *publisher* itself is
  managed via a plain signed-in web form (no token) at
  https://marketplace.visualstudio.com/manage. Then either:
  1. **Manual web upload**: publisher page → "+ New extension" →
     "Visual Studio Code" → upload the `.vsix` (the vsix's `publisher`
     field must match the publisher id, or the upload is rejected).
     Updates work the same way via the extension's "…" → Update.
  2. **Azure CLI auth**: `az login` with the publisher's account, then
     `npx @vscode/vsce publish --azure-credential --packagePath <file>.vsix`
     — vsce takes an Entra token from the az session instead of a PAT.
- **No Azure account at all?** Use the `github-release` target instead: it
  attaches the `.vsix` and the Obsidian plugin zip to the tag's GitHub
  Release ("Install from VSIX…"). Open VSX also needs no Azure — GitHub login
  plus the Eclipse publisher agreement.
- `--no-dependencies` is correct: esbuild bundles the core into the extension.

### Obsidian plugin

- The `github-release` target zips the drop-in folder
  (`main.js`, `manifest.json`, `styles.css`) onto the GitHub Release. Users
  extract it to `<vault>/.obsidian/plugins/logicspec/` or install via BRAT.
- Listing in the community plugin directory is a separate, manual process:
  tagged releases carrying those three files as individual assets, plus a PR
  to `obsidianmd/obsidian-releases`. Not done yet.

### Claude Code plugin

- No build and no registry: the plugin is served straight from the repository
  via the plugin marketplace manifest. Users install with
  `/plugin marketplace add shynfard/LogicSpec` →
  `/plugin install logicspec@logicspec`.
