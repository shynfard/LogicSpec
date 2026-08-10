import fs from "node:fs";
import path from "node:path";
import { hasErrors } from "../diagnostics/diagnostic.js";
import { renderMarkdown, renderMermaid } from "../renderers/markdown.js";
import type { RenderDirection, RenderView } from "../schema/config.js";
import { featureStem } from "../workspace/loader.js";
import { color, type Io, printDiagnostics, processIo, summarizeDiagnostics } from "./report.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION,
  type FileTarget,
  makeWorkspaceCache,
  resolveTargets,
  validateTarget,
  workspaceDiagnostics,
} from "./shared.js";

export type RenderFormat = "md" | "mermaid";

export interface RenderCommandOptions {
  view?: RenderView;
  format?: RenderFormat;
  output?: string;
  direction?: RenderDirection;
  cwd?: string;
  io?: Io;
}

function outputPathFor(target: FileTarget, format: RenderFormat, outputDir: string): string {
  const extension = format === "mermaid" ? ".mmd" : ".md";
  return path.join(outputDir, `${featureStem(target.path)}${extension}`);
}

/** `logicspec render <files...>` — validates first; never renders an invalid spec. */
export function runRender(paths: readonly string[], options: RenderCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const format: RenderFormat = options.format ?? "md";

  const { targets, diagnostics: resolveDiagnostics } = resolveTargets(paths, cwd);
  if (resolveDiagnostics.length > 0) {
    printDiagnostics(resolveDiagnostics, io);
    return EXIT_USAGE;
  }

  const explicitFile =
    options.output !== undefined &&
    (path.extname(options.output) === ".md" || path.extname(options.output) === ".mmd") &&
    !(fs.existsSync(options.output) && fs.statSync(options.output).isDirectory());

  if (explicitFile && targets.length > 1) {
    io.err("Cannot write multiple features to a single --output file. Pass a directory instead.");
    return EXIT_USAGE;
  }

  const workspaceFor = makeWorkspaceCache();
  const printedWorkspaces = new Set<string>();
  let sawFatal = false;
  let sawError = false;

  for (const target of targets) {
    const workspace = workspaceFor(path.dirname(target.path));
    if (!printedWorkspaces.has(workspace.root)) {
      printedWorkspaces.add(workspace.root);
      const findings = workspaceDiagnostics(workspace);
      printDiagnostics(findings, io);
      if (hasErrors(findings)) sawError = true;
    }

    const { result, fatal } = validateTarget(target, workspaceFor);
    if (!result.valid || !result.normalized || !result.graph) {
      printDiagnostics(result.diagnostics, io);
      io.err(
        `${color.red("✗")} ${target.display} is invalid (${summarizeDiagnostics(result.diagnostics)}); nothing rendered.`,
      );
      if (fatal) sawFatal = true;
      else sawError = true;
      continue;
    }

    const view = options.view ?? workspace.config.render.view;
    const direction = options.direction ?? workspace.config.render.direction;

    const content =
      format === "mermaid"
        ? renderMermaid(result.normalized, result.graph, { view, direction })
        : renderMarkdown(result.normalized, result.graph, {
            view,
            direction,
            source: target.display,
          });

    const outFile = explicitFile
      ? path.resolve(cwd, options.output as string)
      : outputPathFor(
          target,
          format,
          options.output !== undefined
            ? path.resolve(cwd, options.output)
            : path.resolve(workspace.root, workspace.config.output.directory),
        );

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, content, "utf8");
    io.out(`${color.green("✓")} ${target.display} → ${path.relative(cwd, outFile)}`);
  }

  if (sawFatal) return EXIT_USAGE;
  if (sawError) return EXIT_VALIDATION;
  return EXIT_OK;
}
