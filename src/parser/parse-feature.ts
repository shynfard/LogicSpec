import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { type FeatureFile, featureFileSchema } from "../schema/feature.js";
import { validateStructure } from "../validator/structural.js";
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
}

/**
 * Parses and structurally validates one feature file:
 * YAML syntax → schema shape → file-local structural rules.
 *
 * Cross-file semantics (catalogs, subflows, graph analysis) live in
 * validateFeature().
 */
export function parseFeature(source: string, options: ParseOptions = {}): ParseResult<FeatureFile> {
  const { file } = options;
  const yaml = loadYaml(source, file);
  if (!yaml.ok) {
    return { ok: false, diagnostics: yaml.diagnostics, locate: yaml.locate };
  }

  const parsed = featureFileSchema.safeParse(yaml.value);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: zodIssuesToDiagnostics(parsed.error.issues, yaml.value, yaml.locate, file),
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
