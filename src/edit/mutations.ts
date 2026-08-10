/**
 * Document-level editing operations for two-way YAML ↔ visual editing.
 *
 * All mutations operate on the parsed `yaml` Document so comments, key order
 * and formatting of untouched parts are preserved. Callers re-validate by
 * serializing and re-parsing (or via `reparse`).
 */
import { type Document, isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";
import type { Diagnostic, DocPath } from "../diagnostics/diagnostic.js";
import type { EdgeKind } from "../graph/normalize.js";
import { parseFeature } from "../parser/parse-feature.js";
import { identifierSchema } from "../schema/common.js";
import type { FeatureFile, StepType } from "../schema/feature.js";
import { stepTemplate } from "./templates.js";

/** A feature open for editing: the source Document plus its parsed view. */
export interface EditableFeature {
  document: Document;
  /** Present when the document currently passes schema validation. */
  feature?: FeatureFile;
  diagnostics: Diagnostic[];
}

/** Parses YAML source into an editable feature. Never throws on invalid input. */
export function loadEditableFeature(source: string, file?: string): EditableFeature {
  const document = parseDocument(source, { keepSourceTokens: true });
  const parsed = parseFeature(source, { file });
  return { document, feature: parsed.data, diagnostics: parsed.diagnostics };
}

/**
 * Serializes the document back to YAML, preserving comments and ordering.
 * Throws for documents with YAML syntax errors — a broken parse has no
 * faithful AST, and stringifying it could silently drop user content.
 * Guard on `diagnostics` (LS001) before mutating or serializing.
 */
export function serializeFeature(editable: EditableFeature): string {
  if (editable.document.errors.length > 0) {
    throw new Error("cannot serialize a document with YAML syntax errors");
  }
  const out = editable.document.toString();
  return out.endsWith("\n") ? out : `${out}\n`;
}

/** Refreshes `feature`/`diagnostics` from the current document state. */
export function reparse(editable: EditableFeature): void {
  const parsed = parseFeature(serializeFeature(editable));
  editable.feature = parsed.data;
  editable.diagnostics = parsed.diagnostics;
}

/**
 * Inserts a new step with a minimal schema-valid template for the type.
 * Throws if the id already exists or is not a valid identifier.
 */
export function addStep(editable: EditableFeature, id: string, type: StepType): void {
  requireIdentifier(id, "step id");
  const { document } = editable;
  if (document.hasIn(["steps", id])) {
    throw new Error(`step "${id}" already exists`);
  }
  const start = document.getIn(["start"]);
  const fallbackNext = typeof start === "string" ? start : id;
  document.setIn(["steps", id], stepTemplate(type, fallbackNext));
}

/** Removes a step and every transition entry that targets it. */
export function deleteStep(editable: EditableFeature, id: string): void {
  const { document } = editable;
  if (!document.deleteIn(["steps", id])) {
    throw new Error(`step "${id}" does not exist`);
  }
  deleteReferencesTo(document, id);
}

/** Renames a step, updating `start` and every reference to it. */
export function renameStep(editable: EditableFeature, oldId: string, newId: string): void {
  requireIdentifier(newId, "step id");
  if (oldId === newId) return;
  const { document } = editable;
  if (document.hasIn(["steps", newId])) {
    throw new Error(`step "${newId}" already exists`);
  }
  const steps = stepsMap(document);
  const pair = steps?.items.find((p) => isScalar(p.key) && p.key.value === oldId);
  if (!pair) {
    throw new Error(`step "${oldId}" does not exist`);
  }
  // Mutate the existing key scalar in place so comments and blank lines
  // attached to the entry stay untouched.
  if (isScalar(pair.key)) {
    pair.key.value = newId;
  } else {
    pair.key = document.createNode(newId);
  }
  renameReferences(document, oldId, newId);
}

export type EditableStepField =
  | "label"
  | "actor"
  | "description"
  | "route"
  | "message"
  | "expression";

/** Sets or (with undefined) deletes a scalar step property. */
export function setStepField(
  editable: EditableFeature,
  id: string,
  field: EditableStepField,
  value: string | undefined,
): void {
  const { document } = editable;
  if (stepNode(document, id) === undefined) {
    throw new Error(`step "${id}" does not exist`);
  }
  if (value === undefined) {
    document.deleteIn(["steps", id, field]);
  } else {
    document.setIn(["steps", id, field], value);
  }
}

export interface AddedTransition {
  kind: EdgeKind;
  /** Document path of the created `next` scalar. */
  path: DocPath;
}

/**
 * Adds a type-appropriate transition from one step to another:
 * page/error → new action, operation/subflow → new `on` outcome (or `next`
 * when empty; an existing bare `next` is first moved into `on.done` so the
 * step never ends up with both), decision → new case,
 * event(publish)/wait/parallel → `next`.
 * Throws for final steps and for waiting events (edit `on` directly).
 */
export function addTransition(
  editable: EditableFeature,
  fromId: string,
  toId: string,
): AddedTransition {
  requireIdentifier(toId, "transition target");
  const { document } = editable;
  const step = stepNode(document, fromId);
  if (step === undefined) {
    throw new Error(`step "${fromId}" does not exist`);
  }
  const type = step.get("type");

  switch (type) {
    case "page":
    case "error": {
      const key = freeKey(step.get("actions"), "go");
      const path = ["steps", fromId, "actions", key, "next"];
      document.setIn(path, toId);
      return { kind: "action", path };
    }
    case "operation":
    case "subflow": {
      const hasNext = step.has("next");
      const hasOn = isMap(step.get("on"));
      if (!hasNext && !hasOn) {
        const path = ["steps", fromId, "next"];
        document.setIn(path, toId);
        return { kind: "next", path };
      }
      if (hasNext) {
        const previous = step.get("next");
        document.deleteIn(["steps", fromId, "next"]);
        if (typeof previous === "string") {
          const doneKey = freeKey(step.get("on"), "done");
          document.setIn(["steps", fromId, "on", doneKey, "next"], previous);
        }
      }
      const key = freeKey(step.get("on"), "outcome");
      const path = ["steps", fromId, "on", key, "next"];
      document.setIn(path, toId);
      return { kind: "outcome", path };
    }
    case "decision": {
      const existing = step.get("cases");
      if (isSeq(existing)) {
        document.addIn(["steps", fromId, "cases"], { next: toId });
        const path = ["steps", fromId, "cases", existing.items.length - 1, "next"];
        return { kind: "decision", path };
      }
      document.setIn(["steps", fromId, "cases"], [{ next: toId }]);
      return { kind: "decision", path: ["steps", fromId, "cases", 0, "next"] };
    }
    case "event": {
      if (step.get("direction") === "wait") {
        throw new Error(
          `event "${fromId}" waits — edit its "on.received"/"on.timeout" transitions directly`,
        );
      }
      const path = ["steps", fromId, "next"];
      document.setIn(path, toId);
      return { kind: "next", path };
    }
    case "wait":
    case "parallel": {
      const path = ["steps", fromId, "next"];
      document.setIn(path, toId);
      return { kind: "next", path };
    }
    case "final":
      throw new Error(`final step "${fromId}" cannot have outgoing transitions`);
    default:
      throw new Error(`step "${fromId}" has no known type (found ${JSON.stringify(type)})`);
  }
}

/**
 * Removes the transition whose `next` scalar lives at `path`
 * (as reported by NormalizedTransition.path), deleting the enclosing
 * action / outcome / case entry. Containers left empty are removed too.
 */
export function removeTransitionAt(editable: EditableFeature, path: DocPath): void {
  const { document } = editable;
  const stepId = path[1];
  if (path[0] !== "steps" || typeof stepId !== "string" || path[path.length - 1] !== "next") {
    throw unsupportedPath(path);
  }

  if (path.length === 3) {
    mustDelete(document, ["steps", stepId, "next"]);
    return;
  }
  if (path.length === 4 && path[2] === "default") {
    mustDelete(document, ["steps", stepId, "default"]);
    return;
  }
  if (path.length === 5) {
    const container = path[2];
    const key = path[3];
    if ((container === "actions" || container === "on") && typeof key === "string") {
      mustDelete(document, ["steps", stepId, container, key]);
      cleanupIfEmpty(document, ["steps", stepId, container]);
      return;
    }
    if (container === "cases" && typeof key === "number") {
      mustDelete(document, ["steps", stepId, "cases", key]);
      cleanupIfEmpty(document, ["steps", stepId, "cases"]);
      return;
    }
  }
  throw unsupportedPath(path);
}

// ── Internals ────────────────────────────────────────────────────────────────

function requireIdentifier(value: string, what: string): void {
  if (!identifierSchema.safeParse(value).success) {
    throw new Error(
      `${what} "${value}" is not a valid identifier (must start with a letter; letters, digits, '-' or '_')`,
    );
  }
}

function stepsMap(document: Document): YAMLMap | undefined {
  const node = document.getIn(["steps"]);
  return isMap(node) ? node : undefined;
}

function stepNode(document: Document, id: string): YAMLMap | undefined {
  const node = document.getIn(["steps", id]);
  return isMap(node) ? node : undefined;
}

/** First unused key in a map: base, base-2, base-3, … */
function freeKey(container: unknown, base: string): string {
  const used = new Set<string>();
  if (isMap(container)) {
    for (const pair of container.items) {
      if (isScalar(pair.key)) used.add(String(pair.key.value));
    }
  }
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Rewrites a map's `next` scalar when it targets `oldId`. */
function retargetNext(map: YAMLMap, oldId: string, newId: string): void {
  const node = map.get("next", true);
  if (isScalar(node) && node.value === oldId) {
    node.value = newId;
  }
}

/** Applies `fn` to every map-valued entry of a map (actions, on). */
function forEachEntryMap(container: unknown, fn: (entry: YAMLMap) => void): void {
  if (!isMap(container)) return;
  for (const pair of container.items) {
    if (isMap(pair.value)) fn(pair.value);
  }
}

/**
 * Updates every transition reference from oldId to newId. Only the schema's
 * transition positions are touched — `next` keys inside `extensions` data or
 * subflow `flow` references (a different namespace) are left alone.
 */
function renameReferences(document: Document, oldId: string, newId: string): void {
  const start = document.getIn(["start"], true);
  if (isScalar(start) && start.value === oldId) {
    start.value = newId;
  }
  const steps = stepsMap(document);
  if (!steps) return;
  for (const stepPair of steps.items) {
    const step = stepPair.value;
    if (!isMap(step)) continue;
    retargetNext(step, oldId, newId);
    forEachEntryMap(step.get("actions"), (entry) => retargetNext(entry, oldId, newId));
    forEachEntryMap(step.get("on"), (entry) => retargetNext(entry, oldId, newId));
    const cases = step.get("cases");
    if (isSeq(cases)) {
      for (const item of cases.items) {
        if (isMap(item)) retargetNext(item, oldId, newId);
      }
    }
    const defaultCase = step.get("default");
    if (isMap(defaultCase)) retargetNext(defaultCase, oldId, newId);
  }
}

/** Removes every transition construct that targets `id`. */
function deleteReferencesTo(document: Document, id: string): void {
  const steps = stepsMap(document);
  if (!steps) return;
  for (const stepPair of steps.items) {
    const step = stepPair.value;
    if (!isMap(step)) continue;

    if (step.get("next") === id) step.delete("next");
    deleteMatchingEntries(step, "actions", id);
    deleteMatchingEntries(step, "on", id);

    const cases = step.get("cases");
    if (isSeq(cases)) {
      for (let i = cases.items.length - 1; i >= 0; i--) {
        const item = cases.items[i];
        if (isMap(item) && item.get("next") === id) cases.delete(i);
      }
      if (cases.items.length === 0) step.delete("cases");
    }

    const defaultCase = step.get("default");
    if (isMap(defaultCase) && defaultCase.get("next") === id) step.delete("default");
  }
}

/** Deletes entries of actions/on whose `next` targets `id`; drops empty containers. */
function deleteMatchingEntries(step: YAMLMap, containerKey: "actions" | "on", id: string): void {
  const container = step.get(containerKey);
  if (!isMap(container)) return;
  const doomedKeys: unknown[] = [];
  for (const pair of container.items) {
    if (isMap(pair.value) && pair.value.get("next") === id) doomedKeys.push(pair.key);
  }
  for (const key of doomedKeys) container.delete(key);
  if (container.items.length === 0) step.delete(containerKey);
}

function mustDelete(document: Document, path: ReadonlyArray<string | number>): void {
  // hasIn first: deleteIn throws when an intermediate collection is missing.
  if (!document.hasIn(path) || !document.deleteIn(path)) {
    throw new Error(`no transition found at ${path.join(".")}`);
  }
}

function cleanupIfEmpty(document: Document, path: ReadonlyArray<string | number>): void {
  const node = document.getIn(path);
  if ((isMap(node) || isSeq(node)) && node.items.length === 0) {
    document.deleteIn(path);
  }
}

function unsupportedPath(path: DocPath): Error {
  return new Error(`unsupported transition path: ${path.join(".")}`);
}
