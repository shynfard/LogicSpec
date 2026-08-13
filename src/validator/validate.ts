import type { Severity } from "../diagnostics/codes.js";
import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { resetSuggestBudget } from "../diagnostics/suggest.js";
import { buildGraph, type FeatureGraph } from "../graph/edges.js";
import { type NormalizedFeature, normalizeFeature } from "../graph/normalize.js";
import { parseFeature } from "../parser/parse-feature.js";
import { zodIssuesToDiagnostics } from "../parser/zod-issues.js";
import { type FeatureFile, featureFileSchema } from "../schema/feature.js";
import { type SemanticContext, validateSemantics } from "./semantic.js";
import { computeStats, type FeatureStats } from "./stats.js";
import { validateStructure } from "./structural.js";

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
  // One suggestion budget for this whole feature run (structural + semantic),
  // shared across every unresolved-reference check so a hostile document cannot
  // amplify Levenshtein cost by its reference count. The string path resets
  // again inside parseFeature; both are harmless and keep each pass bounded.
  resetSuggestBudget();

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
    // An already-parsed object skipped the parser and its Zod gate, so a
    // hand-built object may be malformed in ways the FeatureFile type cannot
    // prevent (e.g. `boundary: [null]`), which would otherwise throw downstream
    // in structural traversal or normalization. Re-validate the shape here so a
    // malformed object returns diagnostics instead of throwing — the YAML/MCP
    // path is already Zod-gated; this keeps the object API contract from ever
    // throwing. Source locations are unavailable for object inputs.
    const reparsed = featureFileSchema.safeParse(input);
    if (!reparsed.success) {
      return {
        valid: false,
        diagnostics: zodIssuesToDiagnostics(
          reparsed.error.issues,
          input,
          () => undefined,
          options.file,
        ),
      };
    }
    feature = reparsed.data;
    // The object also skipped the file-local structural checks (LS301–LS308);
    // run them here so no input path can bypass per-kind event/boundary
    // consistency or the other structural rules.
    diagnostics = validateStructure(feature, () => undefined, options.file);
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
