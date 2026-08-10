import type { StepType } from "../schema/feature.js";

/**
 * Minimal schema-valid template for a newly inserted step.
 *
 * Templates may be structurally incomplete (an empty decision triggers LS303,
 * a bare page is a dead end) — that is intentional: diagnostics guide the
 * author. What matters is that the document still parses against the schema
 * so editors can keep rendering.
 *
 * `fallbackNext` is used where the schema requires a transition target
 * (wait, parallel): the feature's current start step, or the new step itself.
 */
export function stepTemplate(type: StepType, fallbackNext: string): Record<string, unknown> {
  switch (type) {
    case "page":
      return { type: "page" };
    case "decision":
      return { type: "decision" };
    case "operation":
      return { type: "operation" };
    case "error":
      return { type: "error" };
    case "subflow":
      return { type: "subflow", flow: "some-flow" };
    case "final":
      return { type: "final", outcome: "success" };
    case "event":
      return { type: "event", direction: "publish", event: "SomeEvent" };
    case "wait":
      return { type: "wait", duration: "1m", next: fallbackNext };
    case "parallel":
      return {
        type: "parallel",
        branches: { "branch-1": { flow: "some-flow" } },
        next: fallbackNext,
      };
  }
}
