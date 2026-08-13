import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, type DocPath, makeDiagnostic } from "../diagnostics/diagnostic.js";
import type { PathLocator } from "../parser/yaml.js";
import { DECISION_TABLE_TARGET_COLUMN, type FeatureFile } from "../schema/feature.js";

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
        // Raw presence for FORBIDDEN checks: a forbidden field that is present
        // but blank (e.g. a timer with `name: ""`) is still forbidden. Using the
        // blank-aware `has()` here would let an empty forbidden field slip past.
        const present = (field: EventField) => step[field] !== undefined;
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
            if (present(field)) pushKind(`must not set "${field}" ${why}.`, field);
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
        const hasCases = step.cases !== undefined && step.cases.length > 0;
        const table = step.decisionTable;
        if (!hasCases && step.default === undefined && table === undefined) {
          diagnostics.push(
            makeDiagnostic(CODES.EMPTY_DECISION, {
              message: `Decision "${id}" must define at least one case, a decision table, or a default.`,
              file,
              path: ["steps", id],
              location: locate(["steps", id]),
            }),
          );
        }
        if (table !== undefined) {
          const pushTable = (message: string, ...tail: (string | number)[]) => {
            const path: DocPath = ["steps", id, ...tail];
            diagnostics.push(
              makeDiagnostic(CODES.INVALID_DECISION_TABLE, {
                message: `Decision "${id}" ${message}`,
                file,
                path,
                location: locate(path),
              }),
            );
          };
          // A decision uses EITHER free-form cases OR a table, never both.
          if (step.cases !== undefined) {
            pushTable(
              'defines both "cases" and a "decisionTable"; use one or the other.',
              "decisionTable",
            );
          }
          if (table.outputs.length === 0) {
            pushTable("has a decision table with no output columns.", "decisionTable", "outputs");
          }
          if (table.rules.length === 0) {
            pushTable("has a decision table with no rules.", "decisionTable", "rules");
          }
          table.rules.forEach((rule, index) => {
            if (rule.when.length !== table.inputs.length) {
              pushTable(
                `rule ${index + 1} has ${rule.when.length} "when" cell(s) but the table declares ${table.inputs.length} input column(s).`,
                "decisionTable",
                "rules",
                index,
                "when",
              );
            }
            if (rule.then.length !== table.outputs.length) {
              pushTable(
                `rule ${index + 1} has ${rule.then.length} "then" cell(s) but the table declares ${table.outputs.length} output column(s).`,
                "decisionTable",
                "rules",
                index,
                "then",
              );
            }
          });

          // ── Reserved `next` output column ─────────────────────────────────
          // The `next` column names each rule's transition target. It must be
          // unambiguous (at most one), and a table with no target column has no
          // per-rule branch, so it must fall through to a `default` — otherwise
          // it is a silent dead end.
          const nextColumns = table.outputs.reduce<number[]>((acc, header, i) => {
            if (header === DECISION_TABLE_TARGET_COLUMN) acc.push(i);
            return acc;
          }, []);
          if (nextColumns.length > 1) {
            pushTable(
              `has a decision table with ${nextColumns.length} reserved "${DECISION_TABLE_TARGET_COLUMN}" output columns; declare at most one.`,
              "decisionTable",
              "outputs",
            );
          }
          if (nextColumns.length === 0 && step.default === undefined) {
            pushTable(
              `has a decision table with no reserved "${DECISION_TABLE_TARGET_COLUMN}" column and no "default", so it produces no outgoing transition. Add a "${DECISION_TABLE_TARGET_COLUMN}" output column or a "default".`,
              "decisionTable",
            );
          }
          // A `-`/blank cell in the reserved `next` column is not a real target.
          // Flag it here with a dedicated message instead of the generic LS101
          // unknown-target error (normalize skips these cells accordingly).
          if (nextColumns.length >= 1) {
            const nextColumn = nextColumns[0] as number;
            table.rules.forEach((rule, index) => {
              const cell = rule.then[nextColumn];
              if (cell !== undefined && (cell.trim() === "" || cell.trim() === "-")) {
                pushTable(
                  `rule ${index + 1}'s reserved "${DECISION_TABLE_TARGET_COLUMN}" cell must name a real step; "-"/blank is not a valid target.`,
                  "decisionTable",
                  "rules",
                  index,
                  "then",
                  nextColumn,
                );
              }
            });
          }
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
