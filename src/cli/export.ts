import fs from "node:fs";
import path from "node:path";
import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { inspectFeature } from "../inspect.js";
import { renderMarkdown } from "../renderers/markdown.js";
import {
  renderWorkspaceGraph,
  type WorkspaceFeatureSummary,
} from "../renderers/workspace-graph.js";
import { featureStem } from "../workspace/loader.js";
import { color, type Io, printDiagnostics, processIo, summarizeDiagnostics } from "./report.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION,
  makeWorkspaceCache,
  requireWorkspace,
  resolveConfigOutputDir,
  validateTarget,
  workspaceDiagnostics,
} from "./shared.js";

export interface ExportCommandOptions {
  output?: string;
  cwd?: string;
  io?: Io;
}

/**
 * `logicspec export [dir]` — builds the complete workspace artifact set into
 * the output directory (default `.logicspec/`, the project's build folder):
 *
 *   <stem>.md          rendered diagram per valid feature
 *   <stem>.json        inspect report per valid feature (stable model)
 *   dependencies.md    workspace dependency graph
 *   workspace.json     index: features, validity, services, events
 *   diagnostics.json   every finding across the workspace
 *
 * Invalid features are never rendered (their previous artifacts are left
 * untouched); their diagnostics land in diagnostics.json and the exit code.
 */
export function runExport(dirArg: string | undefined, options: ExportCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const startDir = path.resolve(cwd, dirArg ?? ".");

  const resolved = requireWorkspace(startDir);
  if ("error" in resolved) {
    printDiagnostics([resolved.error], io);
    return EXIT_USAGE;
  }
  const { workspace } = resolved;

  let outDir: string;
  if (options.output !== undefined) {
    outDir = path.resolve(cwd, options.output);
  } else {
    const resolvedOut = resolveConfigOutputDir(workspace);
    if ("error" in resolvedOut) {
      printDiagnostics([resolvedOut.error], io);
      return EXIT_USAGE;
    }
    outDir = resolvedOut.dir;
  }
  fs.mkdirSync(outDir, { recursive: true });

  const wsFindings = workspaceDiagnostics(workspace);
  printDiagnostics(wsFindings, io);

  const workspaceFor = makeWorkspaceCache();
  const allDiagnostics: Array<{ file: string; diagnostics: Diagnostic[] }> = [
    { file: workspace.configPath ?? workspace.root, diagnostics: wsFindings },
  ];
  const index: Array<{ id: string; file: string; valid: boolean; name?: string }> = [];
  let sawFatal = false;
  let sawError = hasErrors(wsFindings);

  for (const ref of workspace.features) {
    const display = path.relative(cwd, ref.path) || ref.path;
    const { result, fatal } = validateTarget({ path: ref.path, display }, workspaceFor);
    allDiagnostics.push({ file: display, diagnostics: result.diagnostics });
    if (fatal) sawFatal = true;
    if (hasErrors(result.diagnostics)) sawError = true;

    const stem = featureStem(ref.path);
    index.push({
      id: result.normalized?.id ?? stem,
      file: display,
      valid: result.valid,
      name: result.normalized?.name,
    });

    if (!result.valid || !result.normalized || !result.graph) {
      printDiagnostics(result.diagnostics, io);
      io.err(
        `${color.red("✗")} ${display} is invalid (${summarizeDiagnostics(result.diagnostics)}); artifacts not refreshed.`,
      );
      continue;
    }

    const markdown = renderMarkdown(result.normalized, result.graph, {
      view: workspace.config.render.view,
      direction: workspace.config.render.direction,
      source: display,
    });
    fs.writeFileSync(path.join(outDir, `${stem}.md`), markdown, "utf8");
    fs.writeFileSync(
      path.join(outDir, `${stem}.json`),
      `${JSON.stringify(inspectFeature(result.normalized, result.graph), null, 2)}\n`,
      "utf8",
    );
    io.out(
      `${color.green("✓")} ${display} → ${path.join(path.relative(cwd, outDir), `${stem}.{md,json}`)}`,
    );
  }

  if (workspace.features.length > 0) {
    const summaries: WorkspaceFeatureSummary[] = workspace.features
      .map((ref) => ({
        id: ref.id ?? featureStem(ref.path),
        name: ref.name ?? ref.id ?? featureStem(ref.path),
        subflows: [...ref.flows].sort(),
        details: [...ref.details].sort(),
        publishes: [...ref.publishes].sort(),
        waitsFor: [...ref.waitsFor].sort(),
        services: [...ref.services].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const graph = renderWorkspaceGraph(summaries, { direction: "LR" });
    fs.writeFileSync(
      path.join(outDir, "dependencies.md"),
      [
        "# Workspace dependencies",
        "",
        "> **GENERATED FILE — DO NOT EDIT.**",
        ">",
        "> Regenerate with `logicspec export`.",
        "",
        "```mermaid",
        graph.trimEnd(),
        "```",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  fs.writeFileSync(
    path.join(outDir, "workspace.json"),
    `${JSON.stringify(
      {
        features: index,
        services: Object.keys(workspace.services?.services ?? {}),
        events: Object.keys(workspace.events?.events ?? {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outDir, "diagnostics.json"),
    `${JSON.stringify({ files: allDiagnostics }, null, 2)}\n`,
    "utf8",
  );
  io.out(
    `${color.green("✓")} workspace → ${path.join(path.relative(cwd, outDir), "{dependencies.md,workspace.json,diagnostics.json}")}`,
  );

  if (sawFatal) return EXIT_USAGE;
  if (sawError) return EXIT_VALIDATION;
  return EXIT_OK;
}
