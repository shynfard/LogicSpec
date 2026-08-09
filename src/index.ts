/**
 * LogicSpec public API.
 *
 * Everything exported here is covered by semver. Modules not re-exported
 * from this file are internal implementation and may change at any time.
 */

// Diagnostics
export { CODES, CODES_BY_ID, type DiagnosticCode, type Severity } from "./diagnostics/codes.js";
export {
  countBySeverity,
  type Diagnostic,
  type DocPath,
  formatPath,
  hasErrors,
  type SourceLocation,
} from "./diagnostics/diagnostic.js";
export { buildGraph, type FeatureGraph, type GraphEdge, type GraphNode } from "./graph/edges.js";

// Normalized model and graph
export {
  type EdgeKind,
  type NormalizedActor,
  type NormalizedContextVar,
  type NormalizedFeature,
  type NormalizedStep,
  type NormalizedTransition,
  normalizeFeature,
} from "./graph/normalize.js";
// Inspection
export { type InspectReport, inspectFeature } from "./inspect.js";
export { parseEvents } from "./parser/parse-events.js";
// Parsing
export { type ParseOptions, type ParseResult, parseFeature } from "./parser/parse-feature.js";
export { parseServices } from "./parser/parse-services.js";
// Rendering (pure: objects in, strings out — no file system access)
export { type RenderOptions, renderMarkdown, renderMermaid } from "./renderers/markdown.js";
export type { LogicSpecConfig, RenderDirection, RenderView } from "./schema/config.js";
export { CONFIG_FILE_NAME } from "./schema/config.js";
export type { EventDefinition, EventsFile } from "./schema/events.js";
// Schema types
export type { Actor, ContextVar, FeatureFile, Step, StepType } from "./schema/feature.js";
export { generateJsonSchemas } from "./schema/json-schema.js";
export type { Service, ServiceOperation, ServicesFile } from "./schema/services.js";
export { computeStats, type FeatureStats } from "./validator/stats.js";
// Validation
export {
  type ValidateOptions,
  type ValidationResult,
  validateFeature,
} from "./validator/validate.js";
export { DEFAULT_CONFIG, findConfigPath, loadConfig } from "./workspace/config.js";
// Workspace
export {
  featureStem,
  findFeatureFiles,
  loadWorkspace,
  type Workspace,
} from "./workspace/loader.js";
