import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { resetSuggestBudget } from "../diagnostics/suggest.js";
import type { DefinitionsFile } from "../schema/definitions.js";
import { type FeatureFile, featureFileSchema } from "../schema/feature.js";
import { validateStructure } from "../validator/structural.js";
import { expandFeatureRefs } from "./expand-refs.js";
import { loadYaml, type PathLocator } from "./yaml.js";
import { zodIssuesToDiagnostics } from "./zod-issues.js";

export interface ParseResult<T> {
  /** True when the document parsed and is structurally valid. */
  ok: boolean;
  /** Present when ok. */
  data?: T;
  diagnostics: Diagnostic[];
  /** Maps document paths back to source positions. */
  locate: PathLocator;
}

export interface ParseOptions {
  /** File path used in diagnostics. */
  file?: string;
  /**
   * Shared-definitions catalog used to resolve `$ref`s in the feature's actors
   * and steps before schema/structural validation. Omitted when no workspace is
   * loaded — a feature that uses `$ref` without a catalog then reports LS110.
   */
  definitions?: DefinitionsFile;
}

/**
 * Parses and structurally validates one feature file:
 * YAML syntax → schema shape → file-local structural rules.
 *
 * Cross-file semantics (catalogs, subflows, graph analysis) live in
 * validateFeature().
 */
export function parseFeature(source: string, options: ParseOptions = {}): ParseResult<FeatureFile> {
  // Fresh suggestion budget for this file's parse + structural pass, so a prior
  // document that exhausted it cannot suppress this one's suggestions.
  resetSuggestBudget();
  const { file, definitions } = options;
  const yaml = loadYaml(source, file);
  if (!yaml.ok) {
    return { ok: false, diagnostics: yaml.diagnostics, locate: yaml.locate };
  }

  // Resolve `$ref`s into concrete actors/steps FIRST, so every stage below sees
  // a fully-expanded feature. A feature with no `$ref` passes through unchanged.
  // Unresolvable references (LS110/LS111/LS112) short-circuit before schema and
  // graph work, mirroring how a YAML or schema error stops the pipeline.
  const expanded = expandFeatureRefs(yaml.value, definitions, yaml.locate, file);
  if (expanded.diagnostics.length > 0) {
    return { ok: false, diagnostics: expanded.diagnostics, locate: yaml.locate };
  }

  const parsed = featureFileSchema.safeParse(expanded.value);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: zodIssuesToDiagnostics(parsed.error.issues, expanded.value, yaml.locate, file),
      locate: yaml.locate,
    };
  }

  const structural = validateStructure(parsed.data, yaml.locate, file);
  return {
    ok: !hasErrors(structural),
    data: parsed.data,
    diagnostics: structural,
    locate: yaml.locate,
  };
}
