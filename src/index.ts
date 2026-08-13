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
// Semantic diff
export {
  diffFeatures,
  type EdgeRef,
  type FeatureDiff,
  type FieldChange,
  formatFeatureDiff,
  type StepChange,
} from "./diff/diff.js";
// Editing (document-preserving mutations for two-way YAML ↔ visual tooling)
export {
  type AddedTransition,
  addStep,
  addTransition,
  deleteStep,
  type EditableFeature,
  type EditableStepField,
  loadEditableFeature,
  removeTransitionAt,
  renameStep,
  reparse,
  serializeFeature,
  setStepField,
} from "./edit/mutations.js";
export { analyzeDataflow, type DataflowIssue } from "./graph/dataflow.js";
export {
  buildGraph,
  type FeatureGraph,
  type GraphDecisionTable,
  type GraphEdge,
  type GraphNode,
} from "./graph/edges.js";
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
// MCP server (Node-only)
export { createMcpHandler, type McpServerOptions } from "./mcp/server.js";
export { runMcpServer } from "./mcp/stdio.js";
export { parseEvents } from "./parser/parse-events.js";
// Parsing
export { type ParseOptions, type ParseResult, parseFeature } from "./parser/parse-feature.js";
export { parseServices } from "./parser/parse-services.js";
// Rendering (pure: objects in, strings out — no file system access)
export { type RenderOptions, renderMarkdown, renderMermaid } from "./renderers/markdown.js";
export { mermaidNodeIdMap } from "./renderers/mermaid-common.js";
export { renderMermaidEventModel } from "./renderers/mermaid-event-model.js";
// Additional renderers (sequence / event-model are experimental views)
export { renderMermaidSequence } from "./renderers/mermaid-sequence.js";
export {
  renderWorkspaceGraph,
  type WorkspaceFeatureSummary,
  type WorkspaceGraphOptions,
  workspaceGraphNodeIdMap,
} from "./renderers/workspace-graph.js";
export type { LogicSpecConfig, RenderDirection, RenderView } from "./schema/config.js";
export { CONFIG_FILE_NAME } from "./schema/config.js";
export type { EventDefinition, EventsFile } from "./schema/events.js";
// Schema types
export {
  type Actor,
  type ContextVar,
  DECISION_TABLE_TARGET_COLUMN,
  type DecisionRule,
  type DecisionStep,
  type DecisionTable,
  type FeatureFile,
  type FinalKind,
  finalKind,
  type HitPolicy,
  type Step,
  type StepType,
} from "./schema/feature.js";
export { generateJsonSchemas } from "./schema/json-schema.js";
export type { Service, ServiceOperation, ServicesFile } from "./schema/services.js";
export { validateCatalogs } from "./validator/catalogs.js";
export { computeStats, type FeatureStats } from "./validator/stats.js";
// Validation
export {
  applySeverityOverrides,
  type SeverityOverrides,
  type ValidateOptions,
  type ValidationResult,
  validateFeature,
} from "./validator/validate.js";
export { DEFAULT_CONFIG, findConfigPath, loadConfig } from "./workspace/config.js";
// Workspace
export {
  featureDependents,
  featureStem,
  findFeatureFiles,
  loadWorkspace,
  type Workspace,
  type WorkspaceFeatureRef,
} from "./workspace/loader.js";
