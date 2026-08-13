/**
 * Browser-safe subset of the LogicSpec API.
 *
 * Everything re-exported here is pure (no Node file-system or process
 * access), so bundlers can target the browser — the visual editor and other
 * web tooling import from "logicspec/core". Workspace loading, the CLI and
 * the MCP server are Node-only and intentionally absent.
 */

export { CODES, CODES_BY_ID, type DiagnosticCode, type Severity } from "./diagnostics/codes.js";
export {
  countBySeverity,
  type Diagnostic,
  type DocPath,
  formatPath,
  hasErrors,
  type SourceLocation,
} from "./diagnostics/diagnostic.js";
export * from "./edit/mutations.js";
export {
  buildGraph,
  type FeatureGraph,
  type GraphBoundary,
  type GraphDecisionTable,
  type GraphEdge,
  type GraphNode,
} from "./graph/edges.js";
export {
  type EdgeKind,
  type NormalizedActor,
  type NormalizedContextVar,
  type NormalizedFeature,
  type NormalizedStep,
  type NormalizedTransition,
  normalizeFeature,
} from "./graph/normalize.js";
export { type InspectReport, inspectFeature } from "./inspect.js";
export { parseEvents } from "./parser/parse-events.js";
export { type ParseOptions, type ParseResult, parseFeature } from "./parser/parse-feature.js";
export { parseServices } from "./parser/parse-services.js";

export { type RenderOptions, renderMarkdown, renderMermaid } from "./renderers/markdown.js";
export { mermaidNodeIdMap } from "./renderers/mermaid-common.js";
export type { RenderDirection, RenderView } from "./schema/config.js";
export type { EventDefinition, EventsFile } from "./schema/events.js";

export {
  type Actor,
  BOUNDARY_STEP_TYPES,
  type BoundaryHandler,
  type ContextVar,
  DECISION_TABLE_TARGET_COLUMN,
  type DecisionRule,
  type DecisionStep,
  type DecisionTable,
  type FeatureFile,
  type HitPolicy,
  type Step,
  type StepType,
} from "./schema/feature.js";
export type { Service, ServiceOperation, ServicesFile } from "./schema/services.js";
export { computeStats, type FeatureStats } from "./validator/stats.js";
export {
  type ValidateOptions,
  type ValidationResult,
  validateFeature,
} from "./validator/validate.js";
