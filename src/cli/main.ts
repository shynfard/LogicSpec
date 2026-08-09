#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import type { RenderDirection, RenderView } from "../schema/config.js";
import { runInit } from "./init.js";
import { runInspect } from "./inspect.js";
import { type RenderFormat, runRender } from "./render.js";
import { EXIT_USAGE } from "./shared.js";
import { runValidate } from "./validate.js";
import { runWatch } from "./watch.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const VIEWS: readonly RenderView[] = ["flow", "swimlane"];
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
    .description("validate feature files or directories")
    .argument("<paths...>", "feature files or directories")
    .option("--strict", "treat warnings as errors")
    .action((paths: string[], options: { strict?: boolean }) => {
      process.exitCode = runValidate(paths, { strict: options.strict });
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
