import type { z } from "zod";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, type DocPath, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { suggest, withSuggestion } from "../diagnostics/suggest.js";
import { STEP_TYPES } from "../schema/feature.js";
import type { PathLocator } from "./yaml.js";

function getAtPath(root: unknown, path: DocPath): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function isStepPath(path: DocPath): boolean {
  return path.length === 2 && path[0] === "steps";
}

/**
 * Converts Zod issues into LogicSpec diagnostics, upgrading a few common
 * cases (unknown step type, final with transitions) to friendlier messages.
 */
export function zodIssuesToDiagnostics(
  issues: readonly z.core.$ZodIssue[],
  raw: unknown,
  locate: PathLocator,
  file?: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const issue of issues) {
    const path = issue.path.filter(
      (p): p is string | number => typeof p === "string" || typeof p === "number",
    );

    // Zod reports an unknown discriminator either as invalid_union on the step
    // or as invalid_value on the step's "type" property, depending on version.
    const stepPath =
      isStepPath(path) && issue.code === "invalid_union"
        ? path
        : path.length === 3 && path[0] === "steps" && path[2] === "type"
          ? path.slice(0, 2)
          : undefined;
    if (stepPath !== undefined) {
      const step = getAtPath(raw, stepPath);
      const type =
        step !== null && typeof step === "object"
          ? (step as Record<string, unknown>).type
          : undefined;
      if (typeof type === "string" && !(STEP_TYPES as readonly string[]).includes(type)) {
        const suggestion = suggest(type, STEP_TYPES);
        diagnostics.push(
          makeDiagnostic(CODES.SCHEMA_ERROR, {
            message: withSuggestion(
              `Unknown step type "${type}". Valid types: ${STEP_TYPES.join(", ")}.`,
              suggestion,
            ),
            file,
            path: [...stepPath, "type"],
            location: locate([...stepPath, "type"]),
            suggestion,
          }),
        );
        continue;
      }
      if (type === undefined) {
        diagnostics.push(
          makeDiagnostic(CODES.SCHEMA_ERROR, {
            message: `Step is missing required property "type". Valid types: ${STEP_TYPES.join(", ")}.`,
            file,
            path: stepPath,
            location: locate(stepPath),
          }),
        );
        continue;
      }
    }

    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys;
      const container = getAtPath(raw, path);
      const containerType =
        container !== null && typeof container === "object"
          ? (container as Record<string, unknown>).type
          : undefined;

      if (
        isStepPath(path) &&
        containerType === "final" &&
        keys.some((k) => k === "next" || k === "on")
      ) {
        diagnostics.push(
          makeDiagnostic(CODES.INVALID_FINAL, {
            message: `Final step "${String(path[1])}" must not have outgoing transitions (found: ${keys.join(", ")}).`,
            file,
            path,
            location: locate([...path, keys[0] ?? "next"]),
          }),
        );
        continue;
      }

      diagnostics.push(
        makeDiagnostic(CODES.SCHEMA_ERROR, {
          message: `Unknown propert${keys.length === 1 ? "y" : "ies"}: ${keys
            .map((k) => `"${k}"`)
            .join(", ")}.`,
          file,
          path,
          location: locate([...path, keys[0] ?? ""]),
        }),
      );
      continue;
    }

    diagnostics.push(
      makeDiagnostic(CODES.SCHEMA_ERROR, {
        message: issue.message,
        file,
        path,
        location: locate(path),
      }),
    );
  }

  return diagnostics;
}
