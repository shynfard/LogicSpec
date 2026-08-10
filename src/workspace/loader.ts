import fs from "node:fs";
import path from "node:path";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { parseEvents } from "../parser/parse-events.js";
import { parseFeature } from "../parser/parse-feature.js";
import { parseServices } from "../parser/parse-services.js";
import { loadYaml, type PathLocator } from "../parser/yaml.js";
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
  /** Display name; falls back to the id/stem when unparseable. */
  name?: string;
  /** Final outcomes declared by the feature (empty when unparseable). */
  outcomes: string[];
  /** Feature ids/stems this feature invokes via subflow or parallel branches. */
  flows: string[];
  /** Event names this feature publishes. */
  publishes: string[];
  /** Event names this feature waits for. */
  waitsFor: string[];
  /** Service ids this feature calls (operations and page loads). */
  services: string[];
}

/** One referenced OpenAPI document, reduced to what validation needs. */
export interface OpenApiDocument {
  operationIds: Set<string>;
  /** method is uppercase, path as written in the document. */
  operations: Array<{ operationId: string; method: string; path: string }>;
}

/** One referenced AsyncAPI document, reduced to what validation needs. */
export interface AsyncApiDocument {
  /** Channel keys plus (AsyncAPI 3) channel addresses. */
  channels: Set<string>;
}

/**
 * Everything shared across features in one workspace: config, catalogs and
 * the set of resolvable subflow names. Catalogs and API documents are parsed
 * once per load, never once per feature.
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
  /** Final outcomes per resolvable flow name (id and stem both map). */
  flowOutcomes?: ReadonlyMap<string, ReadonlySet<string>>;
  /** OpenAPI documents referenced from the service catalog, keyed by absolute path. */
  openApiDocuments: Map<string, OpenApiDocument>;
  /** AsyncAPI documents referenced from the event catalog, keyed by absolute path. */
  asyncApiDocuments: Map<string, AsyncApiDocument>;
  /** Locators for the catalog files, for catalog-level diagnostics. */
  catalogLocators: { services?: PathLocator; events?: PathLocator };
  /** Paths of the catalog files, when configured. */
  catalogPaths: { services?: string; events?: string };
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

interface LoadedCatalog<T> {
  data?: T;
  locate?: PathLocator;
  path: string;
}

function loadCatalog<T>(
  filePath: string,
  parse: (
    source: string,
    options: { file: string },
  ) => { data?: T; diagnostics: Diagnostic[]; locate: PathLocator },
  diagnostics: Diagnostic[],
): LoadedCatalog<T> {
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
    return { path: filePath };
  }
  const result = parse(source, { file: filePath });
  diagnostics.push(...result.diagnostics);
  return { data: result.data, locate: result.locate, path: filePath };
}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function loadOpenApiDocument(
  filePath: string,
  diagnostics: Diagnostic[],
): OpenApiDocument | undefined {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push(
      makeDiagnostic(CODES.FILE_ERROR, {
        message: `Cannot read OpenAPI document: ${(error as Error).message}`,
        file: filePath,
      }),
    );
    return undefined;
  }
  const yaml = loadYaml(source, filePath);
  if (!yaml.ok) {
    diagnostics.push(...yaml.diagnostics);
    return undefined;
  }
  const document: OpenApiDocument = { operationIds: new Set(), operations: [] };
  const root = yaml.value;
  const paths =
    root !== null && typeof root === "object" ? (root as Record<string, unknown>).paths : undefined;
  if (paths !== null && typeof paths === "object") {
    for (const [apiPath, item] of Object.entries(paths as Record<string, unknown>)) {
      if (item === null || typeof item !== "object") continue;
      for (const method of HTTP_METHODS) {
        const operation = (item as Record<string, unknown>)[method];
        if (operation === null || typeof operation !== "object") continue;
        const operationId = (operation as Record<string, unknown>).operationId;
        if (typeof operationId === "string") {
          document.operationIds.add(operationId);
          document.operations.push({ operationId, method: method.toUpperCase(), path: apiPath });
        }
      }
    }
  }
  return document;
}

function loadAsyncApiDocument(
  filePath: string,
  diagnostics: Diagnostic[],
): AsyncApiDocument | undefined {
  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    diagnostics.push(
      makeDiagnostic(CODES.FILE_ERROR, {
        message: `Cannot read AsyncAPI document: ${(error as Error).message}`,
        file: filePath,
      }),
    );
    return undefined;
  }
  const yaml = loadYaml(source, filePath);
  if (!yaml.ok) {
    diagnostics.push(...yaml.diagnostics);
    return undefined;
  }
  const channels = new Set<string>();
  const root = yaml.value;
  const channelsNode =
    root !== null && typeof root === "object"
      ? (root as Record<string, unknown>).channels
      : undefined;
  if (channelsNode !== null && typeof channelsNode === "object") {
    for (const [key, channel] of Object.entries(channelsNode as Record<string, unknown>)) {
      channels.add(key);
      // AsyncAPI 3 channels may carry an explicit address distinct from the key.
      if (channel !== null && typeof channel === "object") {
        const address = (channel as Record<string, unknown>).address;
        if (typeof address === "string") channels.add(address);
      }
    }
  }
  return { channels };
}

function collectFlowRefs(featurePath: string): Omit<WorkspaceFeatureRef, "path"> {
  const empty: Omit<WorkspaceFeatureRef, "path"> = {
    outcomes: [],
    flows: [],
    publishes: [],
    waitsFor: [],
    services: [],
  };
  try {
    const parsed = parseFeature(fs.readFileSync(featurePath, "utf8"), { file: featurePath });
    if (!parsed.data) return empty;
    const outcomes = new Set<string>();
    const flows = new Set<string>();
    const publishes = new Set<string>();
    const waitsFor = new Set<string>();
    const services = new Set<string>();
    for (const step of Object.values(parsed.data.steps)) {
      if (step.type === "final") outcomes.add(step.outcome);
      if (step.type === "subflow") flows.add(step.flow);
      if (step.type === "parallel") {
        for (const branch of Object.values(step.branches)) flows.add(branch.flow);
      }
      if (step.type === "event") {
        (step.direction === "publish" ? publishes : waitsFor).add(step.event);
      }
      if (step.type === "operation" && step.call !== undefined) {
        services.add(step.call.slice(0, step.call.indexOf(".")));
      }
      if (step.type === "page") {
        for (const load of step.load ?? []) {
          services.add(load.call.slice(0, load.call.indexOf(".")));
        }
      }
    }
    return {
      id: parsed.data.feature.id,
      name: parsed.data.feature.name,
      outcomes: [...outcomes],
      flows: [...flows],
      publishes: [...publishes],
      waitsFor: [...waitsFor],
      services: [...services],
    };
  } catch {
    return empty;
  }
}

/**
 * Loads the workspace surrounding a directory (or a feature file's directory):
 * nearest config, catalogs, referenced API documents, and the feature index
 * used for subflow resolution and dependency tracking.
 */
export function loadWorkspace(startDir: string): Workspace {
  const loaded = loadConfig(startDir);
  const diagnostics = [...loaded.diagnostics];
  const { root, configPath, config } = loaded;

  let services: ServicesFile | undefined;
  let events: EventsFile | undefined;
  let features: WorkspaceFeatureRef[] = [];
  let knownFlows: Set<string> | undefined;
  let flowOutcomes: Map<string, ReadonlySet<string>> | undefined;
  const openApiDocuments = new Map<string, OpenApiDocument>();
  const asyncApiDocuments = new Map<string, AsyncApiDocument>();
  const catalogLocators: Workspace["catalogLocators"] = {};
  const catalogPaths: Workspace["catalogPaths"] = {};

  if (configPath !== undefined) {
    if (config.catalogs?.services) {
      const servicesPath = path.resolve(root, config.catalogs.services);
      const catalog = loadCatalog(servicesPath, parseServices, diagnostics);
      services = catalog.data;
      catalogLocators.services = catalog.locate;
      catalogPaths.services = servicesPath;
      for (const service of Object.values(services?.services ?? {})) {
        for (const operation of Object.values(service.operations)) {
          if (operation.openapi === undefined) continue;
          const documentPath = path.resolve(path.dirname(servicesPath), operation.openapi.document);
          if (!openApiDocuments.has(documentPath)) {
            const document = loadOpenApiDocument(documentPath, diagnostics);
            if (document) openApiDocuments.set(documentPath, document);
          }
        }
      }
    }
    if (config.catalogs?.events) {
      const eventsPath = path.resolve(root, config.catalogs.events);
      const catalog = loadCatalog(eventsPath, parseEvents, diagnostics);
      events = catalog.data;
      catalogLocators.events = catalog.locate;
      catalogPaths.events = eventsPath;
      for (const event of Object.values(events?.events ?? {})) {
        if (event.asyncapi === undefined) continue;
        const documentPath = path.resolve(path.dirname(eventsPath), event.asyncapi.document);
        if (!asyncApiDocuments.has(documentPath)) {
          const document = loadAsyncApiDocument(documentPath, diagnostics);
          if (document) asyncApiDocuments.set(documentPath, document);
        }
      }
    }

    const featuresDir = path.resolve(root, config.features.directory);
    features = findFeatureFiles(featuresDir).map((filePath) => ({
      path: filePath,
      ...collectFlowRefs(filePath),
    }));

    knownFlows = new Set<string>();
    flowOutcomes = new Map<string, ReadonlySet<string>>();
    for (const ref of features) {
      const outcomes: ReadonlySet<string> = new Set(ref.outcomes);
      knownFlows.add(featureStem(ref.path));
      flowOutcomes.set(featureStem(ref.path), outcomes);
      if (ref.id !== undefined) {
        knownFlows.add(ref.id);
        flowOutcomes.set(ref.id, outcomes);
      }
    }
  }

  return {
    root,
    configPath,
    config,
    services,
    events,
    features,
    knownFlows,
    flowOutcomes,
    openApiDocuments,
    asyncApiDocuments,
    catalogLocators,
    catalogPaths,
    diagnostics,
  };
}

/**
 * Reverse subflow dependencies: which features must be re-validated when a
 * given feature changes. Transitive; keyed and valued by absolute file path.
 */
export function featureDependents(workspace: Workspace): Map<string, Set<string>> {
  const byName = new Map<string, WorkspaceFeatureRef>();
  for (const ref of workspace.features) {
    byName.set(featureStem(ref.path), ref);
    if (ref.id !== undefined) byName.set(ref.id, ref);
  }
  // direct[dependency] = set of dependent files
  const direct = new Map<string, Set<string>>();
  for (const ref of workspace.features) {
    for (const flow of ref.flows) {
      const target = byName.get(flow);
      if (target === undefined) continue;
      const dependents = direct.get(target.path) ?? new Set<string>();
      dependents.add(ref.path);
      direct.set(target.path, dependents);
    }
  }
  // Transitive closure per feature file.
  const result = new Map<string, Set<string>>();
  for (const ref of workspace.features) {
    const seen = new Set<string>();
    const queue = [...(direct.get(ref.path) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (seen.has(current) || current === ref.path) continue;
      seen.add(current);
      queue.push(...(direct.get(current) ?? []));
    }
    result.set(ref.path, seen);
  }
  return result;
}
