import fs from "node:fs";
import path from "node:path";
import { diffFeatures, formatFeatureDiff } from "../diff/diff.js";
import { type NormalizedFeature, normalizeFeature } from "../graph/normalize.js";
import { parseFeature } from "../parser/parse-feature.js";
import { loadWorkspace } from "../workspace/loader.js";
import { type Io, printDiagnostics, processIo } from "./report.js";
import { EXIT_OK, EXIT_USAGE } from "./shared.js";

export interface DiffCommandOptions {
  json?: boolean;
  cwd?: string;
  io?: Io;
}

function loadNormalized(file: string, cwd: string, io: Io): NormalizedFeature | undefined {
  const absolute = path.resolve(cwd, file);
  const display = path.relative(cwd, absolute) || file;
  let source: string;
  try {
    source = fs.readFileSync(absolute, "utf8");
  } catch (error) {
    io.err(`Cannot read ${display}: ${(error as Error).message}`);
    return undefined;
  }
  // Resolve $ref shared definitions against the file's surrounding workspace so
  // both sides of the diff compare fully-expanded features.
  const definitions = loadWorkspace(path.dirname(absolute)).definitions;
  const parsed = parseFeature(source, { file: display, definitions });
  if (!parsed.data) {
    printDiagnostics(parsed.diagnostics, io);
    io.err(`${display} does not parse; cannot diff.`);
    return undefined;
  }
  return normalizeFeature(parsed.data);
}

/**
 * `logicspec diff <before> <after>` — semantic comparison of two feature
 * files: steps, transitions, actors, context and outcomes. Exit code 0
 * regardless of differences; 2 when an input cannot be parsed.
 */
export function runDiff(
  beforeFile: string,
  afterFile: string,
  options: DiffCommandOptions = {},
): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();

  const before = loadNormalized(beforeFile, cwd, io);
  const after = loadNormalized(afterFile, cwd, io);
  if (before === undefined || after === undefined) return EXIT_USAGE;

  const diff = diffFeatures(before, after);
  if (options.json === true) {
    io.out(JSON.stringify(diff, null, 2));
  } else {
    io.out(formatFeatureDiff(diff, beforeFile, afterFile));
  }
  return EXIT_OK;
}
