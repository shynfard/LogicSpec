import fs from "node:fs";
import path from "node:path";
import { hasErrors } from "../diagnostics/diagnostic.js";
import {
  renderWorkspaceGraph,
  type WorkspaceFeatureSummary,
} from "../renderers/workspace-graph.js";
import type { RenderDirection } from "../schema/config.js";
import { featureStem } from "../workspace/loader.js";
import { color, type Io, printDiagnostics, processIo } from "./report.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  requireWorkspace,
  resolveConfigOutputDir,
  workspaceDiagnostics,
} from "./shared.js";

export interface GraphCommandOptions {
  output?: string;
  format?: "md" | "mermaid";
  direction?: RenderDirection;
  services?: boolean;
  cwd?: string;
  io?: Io;
}

/**
 * `logicspec graph [dir]` — renders the workspace dependency graph:
 * features, their subflow relationships, and event publish/wait edges.
 */
export function runGraph(dirArg: string | undefined, options: GraphCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();
  const startDir = path.resolve(cwd, dirArg ?? ".");

  const resolved = requireWorkspace(startDir);
  if ("error" in resolved) {
    printDiagnostics([resolved.error], io);
    return EXIT_USAGE;
  }
  const { workspace } = resolved;
  const findings = workspaceDiagnostics(workspace);
  printDiagnostics(findings, io);

  const summaries: WorkspaceFeatureSummary[] = workspace.features
    .map((ref) => ({
      id: ref.id ?? featureStem(ref.path),
      name: ref.name ?? ref.id ?? featureStem(ref.path),
      subflows: [...ref.flows].sort(),
      publishes: [...ref.publishes].sort(),
      waitsFor: [...ref.waitsFor].sort(),
      services: [...ref.services].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (summaries.length === 0) {
    io.err(`No features found in ${path.relative(cwd, startDir) || "."}.`);
    return EXIT_USAGE;
  }

  const mermaid = renderWorkspaceGraph(summaries, {
    includeServices: options.services === true,
    direction: options.direction ?? "LR",
  });

  const format = options.format ?? "md";
  const content =
    format === "mermaid"
      ? mermaid
      : [
          "# Workspace dependencies",
          "",
          "> **GENERATED FILE — DO NOT EDIT.**",
          ">",
          "> Regenerate with `logicspec graph`.",
          "",
          "```mermaid",
          mermaid.trimEnd(),
          "```",
          "",
        ].join("\n");

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
  const outFile = path.join(outDir, format === "mermaid" ? "dependencies.mmd" : "dependencies.md");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
  io.out(`${color.green("✓")} workspace graph → ${path.relative(cwd, outFile)}`);

  return hasErrors(findings) ? EXIT_USAGE : EXIT_OK;
}
