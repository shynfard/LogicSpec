import type { Severity } from "../diagnostics/codes.js";
import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { buildGraph, type FeatureGraph } from "../graph/edges.js";
import { type NormalizedFeature, normalizeFeature } from "../graph/normalize.js";
import { parseFeature } from "../parser/parse-feature.js";
import type { FeatureFile } from "../schema/feature.js";
import { type SemanticContext, validateSemantics } from "./semantic.js";
import { computeStats, type FeatureStats } from "./stats.js";

/** Per-code severity overrides; "off" removes matching diagnostics entirely. */
export type SeverityOverrides = Readonly<Record<string, Severity | "off">>;

/**
 * Applies configured severity overrides. Returns a new array; diagnostics
 * mapped to "off" are dropped, all others keep their order.
 */
export function applySeverityOverrides(
  diagnostics: readonly Diagnostic[],
  overrides: SeverityOverrides | undefined,
): Diagnostic[] {
  if (overrides === undefined || Object.keys(overrides).length === 0) {
    return [...diagnostics];
  }
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const override = overrides[diagnostic.code];
    if (override === undefined) {
      result.push(diagnostic);
    } else if (override !== "off") {
      result.push({ ...diagnostic, severity: override });
    }
  }
  return result;
}

export interface ValidateOptions extends Omit<SemanticContext, "locate"> {
  /** Per-code severity overrides, usually from logicspec.config.yaml. */
  severityOverrides?: SeverityOverrides;
}

export interface ValidationResult {
  /** True when there are no error-severity diagnostics. */
  valid: boolean;
  diagnostics: Diagnostic[];
  /** Present when the file parsed structurally. */
  feature?: FeatureFile;
  normalized?: NormalizedFeature;
  graph?: FeatureGraph;
  stats?: FeatureStats;
}

/**
 * The full pipeline for one feature:
 * parse → structural validation → normalize → graph → semantic validation.
 *
 * Accepts YAML source or an already parsed FeatureFile. Location information
 * in diagnostics is only available for source input.
 */
export function validateFeature(
  input: string | FeatureFile,
  options: ValidateOptions = {},
): ValidationResult {
  let feature: FeatureFile;
  let diagnostics: Diagnostic[];
  let locate: SemanticContext["locate"];

  if (typeof input === "string") {
    const parsed = parseFeature(input, { file: options.file });
    diagnostics = [...parsed.diagnostics];
    if (parsed.data === undefined) {
      return { valid: false, diagnostics };
    }
    feature = parsed.data;
    locate = parsed.locate;
  } else {
    feature = input;
    diagnostics = [];
    locate = undefined;
  }

  const normalized = normalizeFeature(feature);
  const graph = buildGraph(normalized);
  diagnostics.push(
    ...validateSemantics(normalized, graph, {
      file: options.file,
      services: options.services,
      events: options.events,
      knownFlows: options.knownFlows,
      flowOutcomes: options.flowOutcomes,
      locate,
    }),
  );

  const effective = applySeverityOverrides(diagnostics, options.severityOverrides);
  return {
    valid: !hasErrors(effective),
    diagnostics: effective,
    feature,
    normalized,
    graph,
    stats: computeStats(normalized, graph),
  };
}
