import { CODES, type DiagnosticCode } from "../diagnostics/codes.js";
import { type Diagnostic, type DocPath, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { suggest, withSuggestion } from "../diagnostics/suggest.js";
import {
  type DefinitionSection,
  type DefinitionsFile,
  isRefNode,
  parseDefinitionRef,
  type RefNode,
} from "../schema/definitions.js";
import type { PathLocator } from "./yaml.js";

export interface ExpandRefsResult {
  /** The feature value with every `$ref` resolved to a concrete actor/step. */
  value: unknown;
  /** Reference-resolution diagnostics (LS110/LS111/LS112). All error severity. */
  diagnostics: Diagnostic[];
}

/** Why a definition could not be resolved. */
type DefError =
  | { kind: "unknown"; name: string }
  | { kind: "malformed"; ref: string }
  | { kind: "mismatch"; ref: string; section: DefinitionSection }
  | { kind: "cycle"; trail: string };

type DefResolution = { value: Record<string, unknown> } | { error: DefError };

function asObjectMap(node: unknown): Record<string, unknown> {
  return node !== null && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : {};
}

function sectionHasRef(node: unknown): boolean {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
  return Object.values(node as Record<string, unknown>).some(isRefNode);
}

/** Shallow-merges a `$ref` node's local keys over a resolved base; local wins. */
function mergeOverrides(base: Record<string, unknown>, ref: RefNode): Record<string, unknown> {
  const { $ref: _ignored, ...overrides } = ref;
  return { ...base, ...overrides };
}

const nounFor = (section: DefinitionSection): string => (section === "actors" ? "actor" : "step");
const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Expands `$ref`s in a feature's `actors` and `steps` into concrete definitions,
 * BEFORE schema/structural/graph validation runs. A feature with no `$ref` is
 * returned untouched (byte-identical through the pipeline). All emitted
 * diagnostics are errors, so the caller short-circuits parsing when any appear.
 *
 * Only intra-workspace `definitions#/<section>/<name>` references are accepted;
 * anything else is LS111. A `$ref` whose section does not match its slot (an
 * actor slot pointing at a step, or vice versa) is LS111. An unknown target is
 * LS110. Definitions may reference other same-section definitions; a cycle is
 * LS112.
 */
export function expandFeatureRefs(
  raw: unknown,
  definitions: DefinitionsFile | undefined,
  locate: PathLocator,
  file?: string,
): ExpandRefsResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: raw, diagnostics: [] };
  }
  const root = raw as Record<string, unknown>;
  const actorsHasRef = sectionHasRef(root.actors);
  const stepsHasRef = sectionHasRef(root.steps);
  if (!actorsHasRef && !stepsHasRef) {
    return { value: raw, diagnostics: [] };
  }

  const diagnostics: Diagnostic[] = [];
  const defActors = asObjectMap(definitions?.actors);
  const defSteps = asObjectMap(definitions?.steps);

  const push = (dcode: DiagnosticCode, message: string, path: DocPath) => {
    diagnostics.push(makeDiagnostic(dcode, { message, file, path, location: locate(path) }));
  };

  /** Resolves a named definition, chasing same-section `$ref`s, rejecting cycles. */
  const resolveDefinition = (
    section: DefinitionSection,
    name: string,
    trail: readonly string[],
  ): DefResolution => {
    const key = `${section}/${name}`;
    if (trail.includes(key)) {
      return { error: { kind: "cycle", trail: [...trail, key].join(" → ") } };
    }
    const map = section === "actors" ? defActors : defSteps;
    const def = map[name];
    if (def === undefined || def === null || typeof def !== "object" || Array.isArray(def)) {
      return { error: { kind: "unknown", name } };
    }
    if (isRefNode(def)) {
      const parsed = parseDefinitionRef(def.$ref);
      if (parsed === undefined) return { error: { kind: "malformed", ref: def.$ref } };
      if (parsed.section !== section) {
        return { error: { kind: "mismatch", ref: def.$ref, section } };
      }
      const inner = resolveDefinition(parsed.section, parsed.name, [...trail, key]);
      if ("error" in inner) return inner;
      return { value: mergeOverrides(inner.value, def) };
    }
    return { value: structuredClone(def as Record<string, unknown>) };
  };

  const emitError = (
    error: DefError,
    section: DefinitionSection,
    id: string,
    ref: string,
    path: DocPath,
  ): void => {
    const noun = nounFor(section);
    switch (error.kind) {
      case "unknown": {
        const known = Object.keys(section === "actors" ? defActors : defSteps);
        const suggestion = suggest(error.name, known);
        diagnostics.push(
          makeDiagnostic(CODES.UNKNOWN_REF, {
            message: withSuggestion(
              `${capitalize(noun)} "${id}" references unknown shared ${noun} "${error.name}" ("${ref}").`,
              suggestion,
            ),
            file,
            path,
            location: locate(path),
            suggestion,
          }),
        );
        break;
      }
      case "malformed":
        push(
          CODES.INVALID_REF,
          `${capitalize(noun)} "${id}" resolves through a malformed $ref "${error.ref}" in the definitions catalog; expected "definitions#/${section}/<name>".`,
          path,
        );
        break;
      case "mismatch":
        push(
          CODES.INVALID_REF,
          `${capitalize(noun)} "${id}" resolves through a cross-section $ref "${error.ref}"; a ${section} definition may only reference definitions#/${section}/<name>.`,
          path,
        );
        break;
      case "cycle":
        push(
          CODES.REF_CYCLE,
          `${capitalize(noun)} "${id}" forms a $ref cycle through shared definitions: ${error.trail}.`,
          path,
        );
        break;
    }
  };

  const expandSection = (section: DefinitionSection, node: unknown): unknown => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
    const entries = Object.entries(node as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [id, value] of entries) {
      if (!isRefNode(value)) {
        out[id] = value;
        continue;
      }
      const path: DocPath = [section, id];
      const parsed = parseDefinitionRef(value.$ref);
      if (parsed === undefined) {
        push(
          CODES.INVALID_REF,
          `${capitalize(nounFor(section))} "${id}" has a malformed $ref "${value.$ref}"; expected "definitions#/${section}/<name>".`,
          path,
        );
        continue;
      }
      if (parsed.section !== section) {
        push(
          CODES.INVALID_REF,
          `${capitalize(nounFor(section))} "${id}" references a "${parsed.section}" definition ("${value.$ref}"); a feature ${nounFor(section)} must reference "definitions#/${section}/<name>".`,
          path,
        );
        continue;
      }
      const resolved = resolveDefinition(parsed.section, parsed.name, []);
      if ("error" in resolved) {
        emitError(resolved.error, section, id, value.$ref, path);
        continue;
      }
      out[id] = mergeOverrides(resolved.value, value);
    }
    return out;
  };

  const value: Record<string, unknown> = { ...root };
  if (actorsHasRef) value.actors = expandSection("actors", root.actors);
  if (stepsHasRef) value.steps = expandSection("steps", root.steps);
  return { value, diagnostics };
}
