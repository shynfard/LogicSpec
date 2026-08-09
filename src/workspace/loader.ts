import fs from "node:fs";
import path from "node:path";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { parseEvents } from "../parser/parse-events.js";
import { parseFeature } from "../parser/parse-feature.js";
import { parseServices } from "../parser/parse-services.js";
import type { LogicSpecConfig } from "../schema/config.js";
import type { EventsFile } from "../schema/events.js";
import type { ServicesFile } from "../schema/services.js";
import { loadConfig } from "./config.js";

export const FEATURE_FILE_SUFFIX = ".feature.yaml";

export interface WorkspaceFeatureRef {
  /** Absolute path of the feature file. */
  path: string;
  /** feature.id when the file parses; undefined otherwise. */
  id?: string;
}

/**
 * Everything shared across features in one workspace: config, catalogs and
 * the set of resolvable subflow names. Catalogs are parsed once per load,
 * never once per feature.
 */
export interface Workspace {
  root: string;
  configPath?: string;
  config: LogicSpecConfig;
  services?: ServicesFile;
  events?: EventsFile;
  features: WorkspaceFeatureRef[];
  /** Feature ids and file stems usable as subflow targets. Undefined without a config. */
  knownFlows?: ReadonlySet<string>;
  diagnostics: Diagnostic[];
}

/** Recursively finds *.feature.yaml files, sorted for determinism. */
export function findFeatureFiles(directory: string): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(FEATURE_FILE_SUFFIX)) results.push(full);
    }
  };
  walk(directory);
  return results.sort();
}

export function featureStem(filePath: string): string {
  const base = path.basename(filePath);
  return base.endsWith(FEATURE_FILE_SUFFIX)
    ? base.slice(0, -FEATURE_FILE_SUFFIX.length)
    : base.replace(/\.ya?ml$/, "");
}

function loadCatalog<T>(
  filePath: string,
  parse: (source: string, options: { file: string }) => { data?: T; diagnostics: Diagnostic[] },
  diagnostics: Diagnostic[],
): T | undefined {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push(
      makeDiagnostic(CODES.FILE_ERROR, {
        message: `Cannot read catalog: ${(error as Error).message}`,
        file: filePath,
      }),
    );
    return undefined;
  }
  const result = parse(source, { file: filePath });
  diagnostics.push(...result.diagnostics);
  return result.data;
}

/**
 * Loads the workspace surrounding a directory (or a feature file's directory):
 * nearest config, catalogs, and the feature index used for subflow resolution.
 */
export function loadWorkspace(startDir: string): Workspace {
  const loaded = loadConfig(startDir);
  const diagnostics = [...loaded.diagnostics];
  const { root, configPath, config } = loaded;

  let services: ServicesFile | undefined;
  let events: EventsFile | undefined;
  let features: WorkspaceFeatureRef[] = [];
  let knownFlows: Set<string> | undefined;

  if (configPath !== undefined) {
    if (config.catalogs?.services) {
      services = loadCatalog(
        path.resolve(root, config.catalogs.services),
        parseServices,
        diagnostics,
      );
    }
    if (config.catalogs?.events) {
      events = loadCatalog(path.resolve(root, config.catalogs.events), parseEvents, diagnostics);
    }

    const featuresDir = path.resolve(root, config.features.directory);
    features = findFeatureFiles(featuresDir).map((filePath) => {
      let id: string | undefined;
      try {
        const parsed = parseFeature(fs.readFileSync(filePath, "utf8"), { file: filePath });
        id = parsed.data?.feature.id;
      } catch {
        id = undefined;
      }
      return { path: filePath, id };
    });

    knownFlows = new Set<string>();
    for (const ref of features) {
      knownFlows.add(featureStem(ref.path));
      if (ref.id !== undefined) knownFlows.add(ref.id);
    }
  }

  return { root, configPath, config, services, events, features, knownFlows, diagnostics };
}
