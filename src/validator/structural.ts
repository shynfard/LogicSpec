import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import type { PathLocator } from "../parser/yaml.js";
import type { FeatureFile } from "../schema/feature.js";

/** A string that is present but contains only whitespace. */
function isBlank(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length === 0;
}

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

    // A descriptive `when` guard that is present but blank is a mistake: it
    // renders as an empty `[when: ]` and carries no meaning (LS306).
    const checkGuard = (when: string | undefined, ...tail: string[]) => {
      if (isBlank(when)) {
        diagnostics.push(
          makeDiagnostic(CODES.BLANK_GUARD, {
            message: `Step "${id}" has a blank "when" guard at ${tail.join(".")}; write a descriptive predicate or omit it.`,
            file,
            path: at(...tail),
            location: locate(at(...tail)),
          }),
        );
      }
    };

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
        for (const [outcome, target] of Object.entries(step.on ?? {})) {
          checkGuard(target.when, "on", outcome, "when");
        }
        break;
      }
      case "page": {
        for (const [actionId, action] of Object.entries(step.actions ?? {})) {
          checkGuard(action.when, "actions", actionId, "when");
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
            const subject = step.event ? `"${step.event}"` : "an event";
            diagnostics.push(
              makeDiagnostic(CODES.INVALID_EVENT_STEP, {
                message: `Event "${id}" waits for ${subject} but defines no "on.received" transition.`,
                file,
                path: ["steps", id],
                location: locate(["steps", id]),
              }),
            );
          }
        }

        // ── eventKind consistency (LS305) ─────────────────────────────────
        type EventField = "event" | "after" | "at" | "every" | "name" | "when";
        // A blank string never satisfies a "required per kind" field: an empty
        // `event`/`when`/`at` is as good as absent, so it must not slip past the
        // per-kind requirements as a non-undefined value.
        const has = (field: EventField) =>
          step[field] !== undefined && !isBlank(step[field] as string | undefined);
        const pushKind = (message: string, field?: string) => {
          const path = field ? at(field) : ["steps", id];
          diagnostics.push(
            makeDiagnostic(CODES.INVALID_EVENT_KIND, {
              message: `Event "${id}" ${message}`,
              file,
              path,
              location: locate(path),
            }),
          );
        };
        const forbid = (fields: readonly EventField[], why: string) => {
          for (const field of fields) {
            if (has(field)) pushKind(`must not set "${field}" ${why}.`, field);
          }
        };

        switch (step.eventKind) {
          case undefined:
          case "message":
          case "signal": {
            const lead = step.eventKind ? `is a ${step.eventKind} event and ` : "";
            if (!has("event")) pushKind(`${lead}must name an "event".`, "event");
            forbid(
              ["after", "at", "every", "name", "when"],
              "unless it is a timer, error or conditional event",
            );
            break;
          }
          case "timer": {
            if (step.direction === "publish") {
              pushKind(
                'is a timer event and must use "direction: wait" — a timer is caught, never published.',
                "direction",
              );
            }
            const timerFields = (["after", "at", "every"] as const).filter((f) => has(f));
            if (timerFields.length !== 1) {
              pushKind(
                'is a timer event and must set exactly one of "after", "at" or "every".',
                "eventKind",
              );
            }
            forbid(["event", "name", "when"], "on a timer event");
            break;
          }
          case "error": {
            if (step.name !== undefined && isBlank(step.name)) {
              pushKind('has a blank "name"; give the error a descriptive name or omit it.', "name");
            }
            forbid(["event", "after", "at", "every", "when"], "on an error event");
            break;
          }
          case "conditional": {
            if (step.direction === "publish") {
              pushKind(
                'is a conditional event and must use "direction: wait" — a conditional event is caught, never published.',
                "direction",
              );
            }
            if (!has("when")) pushKind('is a conditional event and must set "when".', "when");
            forbid(["event", "after", "at", "every", "name"], "on a conditional event");
            break;
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
