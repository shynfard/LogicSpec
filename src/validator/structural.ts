import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import type { PathLocator } from "../parser/yaml.js";
import type { FeatureFile } from "../schema/feature.js";

/**
 * File-local structural rules that Zod's shape validation cannot express:
 * mutually exclusive properties and direction-dependent requirements.
 */
export function validateStructure(
  feature: FeatureFile,
  locate: PathLocator,
  file?: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [id, step] of Object.entries(feature.steps)) {
    const at = (...tail: string[]) => ["steps", id, ...tail];

    switch (step.type) {
      case "operation":
      case "subflow": {
        if (step.next !== undefined && step.on !== undefined) {
          diagnostics.push(
            makeDiagnostic(CODES.INVALID_TRANSITIONS, {
              message: `${step.type === "operation" ? "Operation" : "Subflow"} "${id}" defines both "next" and "on". Use "next" for a single outcome or "on" for named outcomes, not both.`,
              file,
              path: at("next"),
              location: locate(at("next")),
            }),
          );
        }
        break;
      }
      case "event": {
        if (step.direction === "publish") {
          if (step.on !== undefined || step.timeout !== undefined) {
            const bad = step.on !== undefined ? "on" : "timeout";
            diagnostics.push(
              makeDiagnostic(CODES.INVALID_EVENT_STEP, {
                message: `Event "${id}" publishes and must use "next", not "${bad}".`,
                file,
                path: at(bad),
                location: locate(at(bad)),
              }),
            );
          }
        } else {
          if (step.next !== undefined) {
            diagnostics.push(
              makeDiagnostic(CODES.INVALID_EVENT_STEP, {
                message: `Event "${id}" waits and must use "on.received" (and optionally "on.timeout"), not "next".`,
                file,
                path: at("next"),
                location: locate(at("next")),
              }),
            );
          }
          if (step.on === undefined) {
            diagnostics.push(
              makeDiagnostic(CODES.INVALID_EVENT_STEP, {
                message: `Event "${id}" waits for "${step.event}" but defines no "on.received" transition.`,
                file,
                path: ["steps", id],
                location: locate(["steps", id]),
              }),
            );
          }
        }
        break;
      }
      case "decision": {
        if ((step.cases === undefined || step.cases.length === 0) && step.default === undefined) {
          diagnostics.push(
            makeDiagnostic(CODES.EMPTY_DECISION, {
              message: `Decision "${id}" must define at least one case or a default.`,
              file,
              path: ["steps", id],
              location: locate(["steps", id]),
            }),
          );
        }
        break;
      }
      case "parallel": {
        if (Object.keys(step.branches).length === 0) {
          diagnostics.push(
            makeDiagnostic(CODES.EMPTY_PARALLEL, {
              message: `Parallel "${id}" must define at least one branch.`,
              file,
              path: at("branches"),
              location: locate(at("branches")),
            }),
          );
        }
        break;
      }
      default:
        break;
    }
  }

  return diagnostics;
}
