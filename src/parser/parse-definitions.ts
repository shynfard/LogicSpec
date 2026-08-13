import { type Diagnostic, hasErrors } from "../diagnostics/diagnostic.js";
import { type DefinitionsFile, definitionsFileSchema } from "../schema/definitions.js";
import { stepTemplateShapeSchema } from "../schema/feature.js";
import { validateDefinitionsGraph } from "./expand-refs.js";
import type { ParseOptions, ParseResult } from "./parse-feature.js";
import { loadYaml, type PathLocator } from "./yaml.js";
import { zodIssuesToDiagnostics } from "./zod-issues.js";

/** True when a value is a plain object carrying a `$ref` key of any type. */
function hasRefKey(node: unknown): boolean {
  return node !== null && typeof node === "object" && !Array.isArray(node) && "$ref" in node;
}

/**
 * Validates each CONCRETE step template against the strict per-type step shape
 * (transitions optional — the caller may supply them). Reporting these here, at
 * catalog load, points a bad template (unknown type, wrong field type, missing
 * type-essential field) at its real location in definitions.yaml instead of the
 * feature step slot that later references it. `$ref` templates are skipped — the
 * reference graph pass covers them.
 */
function validateStepTemplates(rawRoot: unknown, locate: PathLocator, file?: string): Diagnostic[] {
  const steps =
    rawRoot !== null && typeof rawRoot === "object" && !Array.isArray(rawRoot)
      ? (rawRoot as Record<string, unknown>).steps
      : undefined;
  if (steps === null || typeof steps !== "object" || Array.isArray(steps)) return [];

  const diagnostics: Diagnostic[] = [];
  for (const [name, template] of Object.entries(steps as Record<string, unknown>)) {
    if (hasRefKey(template)) continue; // a $ref template — checked by the graph pass
    const parsed = stepTemplateShapeSchema.safeParse(template);
    if (parsed.success) continue;
    // Re-root each Zod issue under ["steps", <name>] so its path and source
    // location resolve against the definitions document, then reuse the shared
    // mapper (which upgrades an unknown discriminator to a friendly message).
    const issues = parsed.error.issues.map((issue) => ({
      ...issue,
      path: ["steps", name, ...issue.path],
    })) as Parameters<typeof zodIssuesToDiagnostics>[0];
    diagnostics.push(...zodIssuesToDiagnostics(issues, rawRoot, locate, file));
  }
  return diagnostics;
}

/** Parses and validates a shared-definitions catalog (definitions.yaml). */
export function parseDefinitions(
  source: string,
  options: ParseOptions = {},
): ParseResult<DefinitionsFile> {
  const { file } = options;
  const yaml = loadYaml(source, file);
  if (!yaml.ok) {
    return { ok: false, diagnostics: yaml.diagnostics, locate: yaml.locate };
  }

  const parsed = definitionsFileSchema.safeParse(yaml.value);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: zodIssuesToDiagnostics(parsed.error.issues, yaml.value, yaml.locate, file),
      locate: yaml.locate,
    };
  }

  // Load-time validation of the WHOLE catalog: the complete $ref graph
  // (cycles/unknown/malformed/too-deep among every definition, even ones no
  // feature references) and each concrete step template's shape. Findings are
  // located in definitions.yaml.
  const diagnostics = [
    ...validateDefinitionsGraph(parsed.data, yaml.locate, file),
    ...validateStepTemplates(yaml.value, yaml.locate, file),
  ];

  return { ok: !hasErrors(diagnostics), data: parsed.data, diagnostics, locate: yaml.locate };
}
