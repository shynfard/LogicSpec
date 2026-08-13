import { z } from "zod";
import { extensionsSchema, identifierSchema, versionSchema } from "./common.js";
import { actorSchema } from "./feature.js";

/**
 * Shared, reusable definitions for cross-file reuse (`definitions.yaml`).
 *
 * A definitions catalog holds named actors and named STEP templates that any
 * feature in the workspace can pull in with a `$ref`. It is expand-on-load: the
 * loader resolves every `$ref` into a concrete actor/step BEFORE graph building,
 * validation, rendering and diff, so nothing downstream ever sees a `$ref`.
 *
 * The only reference syntax accepted (in v1) is an intra-workspace JSON-Pointer
 * style string `definitions#/<section>/<name>`, where `<section>` is `actors`
 * or `steps`. Arbitrary file/URL references are rejected (LS111). Definitions
 * may reference other definitions of the SAME section; cycles are rejected
 * (LS112).
 */

/** The two addressable sections of a definitions catalog. */
export type DefinitionSection = "actors" | "steps";

/** A parsed `definitions#/<section>/<name>` reference. */
export interface ParsedDefinitionRef {
  section: DefinitionSection;
  name: string;
}

/**
 * The one accepted `$ref` shape: `definitions#/actors/<name>` or
 * `definitions#/steps/<name>`. Anything else is malformed (LS111). `<name>`
 * uses the same identifier grammar as every other id in the DSL.
 */
export const DEFINITION_REF_PATTERN = /^definitions#\/(actors|steps)\/([A-Za-z][A-Za-z0-9_-]*)$/;

/** Parses a `$ref` string, or returns undefined when it is malformed. */
export function parseDefinitionRef(ref: string): ParsedDefinitionRef | undefined {
  const match = DEFINITION_REF_PATTERN.exec(ref);
  if (match === null) return undefined;
  return { section: match[1] as DefinitionSection, name: match[2] as string };
}

/** A `$ref` node: an object whose `$ref` is a string. Extra keys are overrides. */
export interface RefNode {
  $ref: string;
  [key: string]: unknown;
}

/** True when a value is a `$ref` node (an object carrying a string `$ref`). */
export function isRefNode(value: unknown): value is RefNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).$ref === "string"
  );
}

/**
 * A `$ref` node in a definitions catalog. Loose so a step template referencing
 * another template may carry local override keys alongside `$ref`.
 */
const definitionRefSchema = z.looseObject({
  $ref: z
    .string()
    .describe(
      'Intra-workspace reference "definitions#/actors/<name>" or "definitions#/steps/<name>".',
    ),
});

/**
 * A reusable STEP template: a step body WITHOUT an id (the caller supplies the
 * id via the map key). It carries a `type`, an optional label/actor and the
 * type-specific fields; it may include transitions or leave them to the caller.
 * The template is intentionally permissive — its final validity is checked
 * against the strict step schema AFTER the caller merges its local overrides, so
 * an unknown type or a missing required field surfaces as a normal structural
 * diagnostic located at the expanded step.
 */
const definitionStepTemplateSchema = z.looseObject({
  type: z
    .string()
    .describe(
      "Step type this template expands to (page/decision/operation/…). Validated after the caller merges local overrides.",
    ),
  label: z.string().optional().describe("Display label. May be overridden at the call site."),
  actor: identifierSchema.optional().describe("Actor responsible for the step."),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  extensions: extensionsSchema.optional(),
});

export const definitionsFileSchema = z.strictObject({
  version: versionSchema,
  actors: z
    .record(identifierSchema, z.union([definitionRefSchema, actorSchema]))
    .optional()
    .describe("Named reusable actor definitions, referenced by features via $ref."),
  steps: z
    .record(identifierSchema, z.union([definitionRefSchema, definitionStepTemplateSchema]))
    .optional()
    .describe("Named reusable step-template definitions, referenced by features via $ref."),
  extensions: extensionsSchema.optional(),
});

export type DefinitionStepTemplate = z.infer<typeof definitionStepTemplateSchema>;
export type DefinitionsFile = z.infer<typeof definitionsFileSchema>;

export const DEFINITIONS_FILE_NAME = "definitions.yaml";
