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

/**
 * Maximum depth of a definition-to-definition `$ref` chain. Legitimate chains
 * are shallow (a template refining another template), so this bound is far above
 * any hand-authored catalog yet small enough that a crafted chain (a linear,
 * NON-cyclic chain thousands of links deep) can never recurse into a stack
 * overflow: exceeding it is reported as a graceful "chain too deep" diagnostic
 * (LS112) instead of crashing the validator.
 */
export const MAX_REF_DEPTH = 100;

/**
 * Belt-and-suspenders cap on the TOTAL number of definition resolutions in a
 * single expansion (or a single catalog graph walk). Each `$ref` node has at
 * most one outgoing pointer, so a chain is linear and the depth cap alone bounds
 * recursion; this second cap guards against any future fan-out and against a
 * pathological catalog with a huge number of independent runaway chains. Far
 * above any real spec; exceeding it is reported as LS112, never a crash.
 */
export const MAX_TOTAL_RESOLUTIONS = 100_000;

/**
 * Cumulative cap on the BYTES of expanded definition content a single expansion
 * may clone. MAX_REF_DEPTH and MAX_TOTAL_RESOLUTIONS bound the DEPTH and COUNT of
 * resolutions, but neither bounds the SIZE: one moderately-large concrete
 * definition (e.g. a 500 KB step template) referenced by a few thousand `$ref`
 * nodes spends only a few thousand of the 100k resolution budget yet would
 * retain `refs × defSize` bytes — a memory-amplification DoS that can OOM-abort
 * the Node process inside `structuredClone` (an uncatchable process abort, not a
 * throw). This third cap bounds the total expanded bytes so the process can
 * never over-allocate: exceeding it is reported as LS112 ("expansion output too
 * large") BEFORE any clone, never a crash. Generous for legitimate reuse, far
 * below an OOM.
 */
export const MAX_TOTAL_EXPANDED_BYTES = 5_000_000;

/** Why a definition could not be resolved. */
type DefError =
  | { kind: "unknown"; name: string }
  | { kind: "malformed"; ref: string }
  | { kind: "mismatch"; ref: string; section: DefinitionSection }
  | { kind: "cycle"; trail: string; loop: readonly string[] }
  | { kind: "too-deep"; trail: string }
  | { kind: "too-large"; trail: string };

type DefResolution = { value: Record<string, unknown> } | { error: DefError };

/** Shared, mutable resolution state: the definition maps plus a spend budget. */
interface ResolveState {
  defActors: Record<string, unknown>;
  defSteps: Record<string, unknown>;
  /** Remaining resolution budget (decremented per resolveDefinition call). */
  remaining: number;
  /**
   * Cumulative bytes of concrete definition content cloned so far this
   * expansion. Guarded against MAX_TOTAL_EXPANDED_BYTES BEFORE each clone.
   */
  expandedBytes: number;
  /**
   * Per-definition-id (`section/name`) size proxy, memoized so a definition
   * referenced N times is measured once, not N times.
   */
  sizeCache: Map<string, number>;
}

/**
 * Cheap byte-size proxy for a concrete definition: the length of its JSON
 * serialization. Used to bound cumulative clone output; a plain parsed-YAML
 * object always serializes, but fail safe (treat an unmeasurable definition as
 * budget-exhausting) so the byte bound can never be silently bypassed.
 */
function estimateDefinitionSize(def: Record<string, unknown>): number {
  const json = JSON.stringify(def);
  return typeof json === "string" ? json.length : MAX_TOTAL_EXPANDED_BYTES;
}

function asObjectMap(node: unknown): Record<string, unknown> {
  return node !== null && typeof node === "object" && !Array.isArray(node)
    ? (node as Record<string, unknown>)
    : {};
}

/** True when `node` is a plain object carrying a `$ref` key of ANY type. */
function hasRefKey(node: unknown): node is Record<string, unknown> {
  return node !== null && typeof node === "object" && !Array.isArray(node) && "$ref" in node;
}

/** Renders a `$ref` value for a message, whatever its (possibly non-string) type. */
function describeRef(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function sectionHasRef(node: unknown): boolean {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
  return Object.values(node as Record<string, unknown>).some(hasRefKey);
}

/** Shallow-merges a `$ref` node's local keys over a resolved base; local wins. */
function mergeOverrides(base: Record<string, unknown>, ref: RefNode): Record<string, unknown> {
  const { $ref: _ignored, ...overrides } = ref;
  return { ...base, ...overrides };
}

const nounFor = (section: DefinitionSection): string => (section === "actors" ? "actor" : "step");
const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Truncates a long resolution trail for a readable "too deep" message. */
function shortTrail(full: readonly string[]): string {
  if (full.length <= 6) return full.join(" → ");
  return [...full.slice(0, 5), "…", full[full.length - 1]].join(" → ");
}

/**
 * Resolves a named definition, chasing same-section definition-to-definition
 * `$ref`s. Rejects cycles (LS112), unknown targets (LS110), malformed or
 * cross-section pointers (LS111), and — critically — chains that exceed
 * MAX_REF_DEPTH or the shared resolution budget (LS112 "too deep"), so a crafted
 * catalog can never drive this into an uncaught stack overflow. Pure and never
 * throws: every failure is returned as a DefError.
 */
function resolveDefinition(
  state: ResolveState,
  section: DefinitionSection,
  name: string,
  trail: readonly string[],
): DefResolution {
  const key = `${section}/${name}`;
  // Depth cap: a runaway (or merely absurd) linear chain stops here instead of
  // recursing until the call stack overflows.
  if (trail.length >= MAX_REF_DEPTH || state.remaining <= 0) {
    return { error: { kind: "too-deep", trail: shortTrail([...trail, key]) } };
  }
  state.remaining -= 1;
  if (trail.includes(key)) {
    const full = [...trail, key];
    const loop = full.slice(full.indexOf(key));
    return { error: { kind: "cycle", trail: full.join(" → "), loop } };
  }
  const map = section === "actors" ? state.defActors : state.defSteps;
  const def = map[name];
  if (def === undefined || def === null || typeof def !== "object" || Array.isArray(def)) {
    return { error: { kind: "unknown", name } };
  }
  // A `$ref` key that is present but not a valid string pointer is malformed
  // (LS111), not a concrete definition to clone.
  if (hasRefKey(def) && !isRefNode(def)) {
    return { error: { kind: "malformed", ref: describeRef(def.$ref) } };
  }
  if (isRefNode(def)) {
    const parsed = parseDefinitionRef(def.$ref);
    if (parsed === undefined) return { error: { kind: "malformed", ref: def.$ref } };
    if (parsed.section !== section) {
      return { error: { kind: "mismatch", ref: def.$ref, section } };
    }
    const inner = resolveDefinition(state, parsed.section, parsed.name, [...trail, key]);
    if ("error" in inner) return inner;
    return { value: mergeOverrides(inner.value, def) };
  }
  // Byte budget: bound the CUMULATIVE size of cloned definition content, not just
  // the COUNT of resolutions. Measure this concrete definition ONCE (cached by
  // id) and STOP before cloning if this clone would push the running total past
  // the cap — so a large definition fanned out across many `$ref`s can never
  // over-allocate and OOM-abort the process inside structuredClone.
  const concrete = def as Record<string, unknown>;
  let defSize = state.sizeCache.get(key);
  if (defSize === undefined) {
    defSize = estimateDefinitionSize(concrete);
    state.sizeCache.set(key, defSize);
  }
  if (state.expandedBytes + defSize > MAX_TOTAL_EXPANDED_BYTES) {
    return { error: { kind: "too-large", trail: shortTrail([...trail, key]) } };
  }
  state.expandedBytes += defSize;
  return { value: structuredClone(concrete) };
}

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
 * LS112, and a chain deeper than MAX_REF_DEPTH is also LS112 ("too deep"). This
 * function never throws on any input — every failure surfaces as a diagnostic.
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
  const state: ResolveState = {
    defActors: asObjectMap(definitions?.actors),
    defSteps: asObjectMap(definitions?.steps),
    remaining: MAX_TOTAL_RESOLUTIONS,
    expandedBytes: 0,
    sizeCache: new Map(),
  };

  const push = (dcode: DiagnosticCode, message: string, path: DocPath) => {
    diagnostics.push(makeDiagnostic(dcode, { message, file, path, location: locate(path) }));
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
        const known = Object.keys(section === "actors" ? state.defActors : state.defSteps);
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
      case "too-deep":
        push(
          CODES.REF_CYCLE,
          `${capitalize(noun)} "${id}" resolves through a $ref chain deeper than ${MAX_REF_DEPTH} levels (possible runaway reference): ${error.trail}.`,
          path,
        );
        break;
      case "too-large":
        push(
          CODES.REF_CYCLE,
          `${capitalize(noun)} "${id}" expands shared definitions past the ${MAX_TOTAL_EXPANDED_BYTES}-byte reuse budget (expansion output too large — possible memory amplification from many $refs to one large definition): ${error.trail}.`,
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
        // An object carrying a non-string `$ref` is a malformed reference
        // (LS111), not a concrete actor/step that should fall through to a
        // generic LS002 schema error.
        if (hasRefKey(value)) {
          push(
            CODES.INVALID_REF,
            `${capitalize(nounFor(section))} "${id}" has a malformed $ref (${describeRef(value.$ref)}); the $ref value must be the string "definitions#/${section}/<name>".`,
            [section, id],
          );
          continue;
        }
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
      const resolved = resolveDefinition(state, parsed.section, parsed.name, []);
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

/**
 * Validates the COMPLETE `$ref` graph of a definitions catalog at load time, so
 * cycles, unknown targets, malformed pointers and runaway-deep chains among
 * definitions are reported even when NO feature references them. Every
 * reference-bearing definition is traversed; findings are located in the
 * catalog file (definitions.yaml), matching the codes the feature-expansion path
 * emits: LS110 (unknown), LS111 (malformed / cross-section), LS112 (cycle / too
 * deep). Deterministic and never throws.
 */
export function validateDefinitionsGraph(
  definitions: DefinitionsFile,
  locate: PathLocator,
  file?: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const state: ResolveState = {
    defActors: asObjectMap(definitions.actors),
    defSteps: asObjectMap(definitions.steps),
    remaining: MAX_TOTAL_RESOLUTIONS,
    expandedBytes: 0,
    sizeCache: new Map(),
  };
  const reportedCycles = new Set<string>();

  const sections: Array<[DefinitionSection, Record<string, unknown>]> = [
    ["actors", state.defActors],
    ["steps", state.defSteps],
  ];

  for (const [section, map] of sections) {
    const noun = nounFor(section);
    for (const name of Object.keys(map)) {
      // Only reference-bearing definitions have a chain to resolve here;
      // concrete definitions are validated by their own schema pass.
      if (!hasRefKey(map[name])) continue;
      // Each definition is resolved independently at load and its clone is
      // discarded (not retained in an output map), so the byte budget guards a
      // single chain here, not the cumulative catalog — reset it per definition
      // to avoid a false LS112 across many independent large definitions.
      state.expandedBytes = 0;
      const resolution = resolveDefinition(state, section, name, []);
      if (!("error" in resolution)) continue;
      const error = resolution.error;
      const path: DocPath = [section, name];
      switch (error.kind) {
        case "unknown": {
          const suggestion = suggest(error.name, Object.keys(map));
          diagnostics.push(
            makeDiagnostic(CODES.UNKNOWN_REF, {
              message: withSuggestion(
                `Shared ${noun} definition "${name}" references unknown shared ${noun} "${error.name}".`,
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
          diagnostics.push(
            makeDiagnostic(CODES.INVALID_REF, {
              message: `Shared ${noun} definition "${name}" has a malformed $ref "${error.ref}"; expected "definitions#/${section}/<name>".`,
              file,
              path,
              location: locate(path),
            }),
          );
          break;
        case "mismatch":
          diagnostics.push(
            makeDiagnostic(CODES.INVALID_REF, {
              message: `Shared ${noun} definition "${name}" references a cross-section $ref "${error.ref}"; a ${section} definition may only reference definitions#/${section}/<name>.`,
              file,
              path,
              location: locate(path),
            }),
          );
          break;
        case "cycle": {
          // A cycle is reachable from every node on it; report each distinct
          // loop once, at the first definition (in source order) that hits it.
          // Key on the SET of nodes so entering the loop from any start dedupes.
          const canonical = [...new Set(error.loop)].sort().join("|");
          if (reportedCycles.has(canonical)) break;
          reportedCycles.add(canonical);
          diagnostics.push(
            makeDiagnostic(CODES.REF_CYCLE, {
              message: `Shared definitions form a $ref cycle: ${error.trail}.`,
              file,
              path,
              location: locate(path),
            }),
          );
          break;
        }
        case "too-deep":
          // A runaway-deep chain is pathological; one diagnostic suffices, and
          // stopping here avoids emitting one per node once the budget is spent.
          diagnostics.push(
            makeDiagnostic(CODES.REF_CYCLE, {
              message: `Shared ${noun} definition "${name}" resolves through a $ref chain deeper than ${MAX_REF_DEPTH} levels (possible runaway reference): ${error.trail}.`,
              file,
              path,
              location: locate(path),
            }),
          );
          return diagnostics;
        case "too-large":
          // A single definition whose expansion alone exceeds the byte budget is
          // pathological; one diagnostic suffices.
          diagnostics.push(
            makeDiagnostic(CODES.REF_CYCLE, {
              message: `Shared ${noun} definition "${name}" expands past the ${MAX_TOTAL_EXPANDED_BYTES}-byte reuse budget (expansion output too large): ${error.trail}.`,
              file,
              path,
              location: locate(path),
            }),
          );
          return diagnostics;
      }
    }
  }

  return diagnostics;
}
