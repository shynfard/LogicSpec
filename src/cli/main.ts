#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { runMcpServer } from "../mcp/stdio.js";
import type { RenderDirection, RenderView } from "../schema/config.js";
import { runDiff } from "./diff.js";
import { runExport } from "./export.js";
import { runGraph } from "./graph.js";
import { runInit } from "./init.js";
import { runInspect } from "./inspect.js";
import { type RenderFormat, runRender } from "./render.js";
import { runServe } from "./serve.js";
import { EXIT_USAGE } from "./shared.js";
import { runValidate } from "./validate.js";
import { runWatch } from "./watch.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];
const FORMATS: readonly RenderFormat[] = ["md", "mermaid"];
const DIRECTIONS: readonly RenderDirection[] = ["TD", "TB", "LR", "RL", "BT"];

function choice<T extends string>(name: string, allowed: readonly T[]): (value: string) => T {
  return (value) => {
    if ((allowed as readonly string[]).includes(value)) return value as T;
    throw new CommanderError(
      EXIT_USAGE,
      "logicspec.invalidOption",
      `Invalid ${name} "${value}". Allowed: ${allowed.join(", ")}.`,
    );
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("logicspec")
    .description("Validate, inspect and visualize LogicSpec feature specifications.")
    .version(version)
    .option("--debug", "print internal stack traces on unexpected errors")
    .exitOverride();

  program
    .command("init")
    .description("scaffold a workspace: config, features/, catalogs and an example feature")
    .action(() => {
      process.exitCode = runInit();
    });

  program
    .command("validate")
    .description("validate feature files or directories (no paths = whole workspace)")
    .argument("[paths...]", "feature files or directories")
    .option("--strict", "treat warnings as errors")
    .option("--json", "print machine-readable JSON instead of text")
    .action((paths: string[], options: { strict?: boolean; json?: boolean }) => {
      process.exitCode = runValidate(paths, { strict: options.strict, json: options.json });
    });

  program
    .command("render")
    .description("render Mermaid diagrams from feature files (validates first)")
    .argument("<paths...>", "feature files or directories")
    .option("--view <view>", `diagram view: ${VIEWS.join(" | ")}`, choice("view", VIEWS))
    .option("--format <format>", `output format: ${FORMATS.join(" | ")}`, choice("format", FORMATS))
    .option(
      "--direction <direction>",
      `flow direction: ${DIRECTIONS.join(" | ")}`,
      choice("direction", DIRECTIONS),
    )
    .option("--output <path>", "output file or directory (default: workspace output directory)")
    .action(
      (
        paths: string[],
        options: {
          view?: RenderView;
          format?: RenderFormat;
          direction?: RenderDirection;
          output?: string;
        },
      ) => {
        process.exitCode = runRender(paths, options);
      },
    );

  program
    .command("inspect")
    .description("summarize a feature (use --json for stable machine-readable output)")
    .argument("<paths...>", "feature files or directories")
    .option("--json", "output stable JSON instead of text")
    .action((paths: string[], options: { json?: boolean }) => {
      process.exitCode = runInspect(paths, options);
    });

  program
    .command("watch")
    .description("watch a workspace and regenerate diagrams on valid changes")
    .argument("[dir]", "directory to watch (default: current workspace)")
    .action((dir: string | undefined) => {
      process.exitCode = runWatch(dir);
    });

  program
    .command("serve")
    .description(
      `run a local read-only dashboard over the workspace (default: http://127.0.0.1:${27000})`,
    )
    .argument("[dir]", "workspace directory (default: current)")
    .option("--port <port>", "port to listen on (default: 27000)", (value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new CommanderError(EXIT_USAGE, "logicspec.invalidOption", `Invalid port "${value}".`);
      }
      return parsed;
    })
    .option("--host <host>", "host to bind (default: 127.0.0.1)")
    .option("--open", "open the dashboard in your default browser")
    .action(
      (dir: string | undefined, options: { port?: number; host?: string; open?: boolean }) => {
        process.exitCode = runServe(dir, options);
      },
    );

  program
    .command("export")
    .description("build the full workspace artifact set into the output directory (.logicspec/)")
    .argument("[dir]", "workspace directory (default: current)")
    .option("--output <path>", "output directory (default: workspace output directory)")
    .action((dir: string | undefined, options: { output?: string }) => {
      process.exitCode = runExport(dir, options);
    });

  program
    .command("graph")
    .description("render the workspace dependency graph (features, subflows, events)")
    .argument("[dir]", "workspace directory (default: current)")
    .option("--format <format>", `output format: ${FORMATS.join(" | ")}`, choice("format", FORMATS))
    .option(
      "--direction <direction>",
      `flow direction: ${DIRECTIONS.join(" | ")}`,
      choice("direction", DIRECTIONS),
    )
    .option("--services", "include service nodes")
    .option("--output <path>", "output directory (default: workspace output directory)")
    .action(
      (
        dir: string | undefined,
        options: {
          format?: RenderFormat;
          direction?: RenderDirection;
          services?: boolean;
          output?: string;
        },
      ) => {
        process.exitCode = runGraph(dir, options);
      },
    );

  program
    .command("diff")
    .description("semantically compare two feature files")
    .argument("<before>", "feature file before the change")
    .argument("<after>", "feature file after the change")
    .option("--json", "print machine-readable JSON instead of text")
    .action((before: string, after: string, options: { json?: boolean }) => {
      process.exitCode = runDiff(before, after, options);
    });

  program
    .command("mcp")
    .description("run the MCP stdio server exposing this workspace to AI agents")
    .argument("[dir]", "workspace directory (default: current)")
    .action((dir: string | undefined) => {
      runMcpServer(dir ?? process.cwd());
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version displays are not errors.
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        process.exitCode = 0;
        return;
      }
      if (error.code === "logicspec.invalidOption") {
        process.stderr.write(`${error.message}\n`);
      }
      process.exitCode = EXIT_USAGE;
      return;
    }
    const debug = process.argv.includes("--debug");
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error: ${message}\n`);
    if (debug && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    } else {
      process.stderr.write("Run again with --debug for details.\n");
    }
    process.exitCode = EXIT_USAGE;
  }
}

// Exit quietly when output is piped into a closed consumer (e.g. `| head`).
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

void main();
