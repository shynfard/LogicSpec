import { describe, expect, it } from "vitest";
import { renderFeatureBlock } from "../src/render.js";

const VALID_FEATURE = `
version: "1"
feature:
  id: demo
  name: Demo
start: home
steps:
  home:
    type: page
    actions:
      go:
        next: done
  done:
    type: final
    outcome: success
`;

describe("renderFeatureBlock", () => {
  it("renders a flowchart for a valid specification", () => {
    const result = renderFeatureBlock(VALID_FEATURE, { view: "flow", direction: "TD" });
    expect(result.valid).toBe(true);
    expect(result.mermaid?.startsWith("flowchart TD")).toBe(true);
    expect(result.mermaid).toContain('home["home<br/>PAGE"]');
  });

  it("honors view and direction options", () => {
    const lr = renderFeatureBlock(VALID_FEATURE, { view: "flow", direction: "LR" });
    expect(lr.mermaid?.startsWith("flowchart LR")).toBe(true);

    const sequence = renderFeatureBlock(VALID_FEATURE, { view: "sequence", direction: "TD" });
    expect(sequence.mermaid?.startsWith("sequenceDiagram")).toBe(true);

    const eventModel = renderFeatureBlock(VALID_FEATURE, { view: "event-model", direction: "TD" });
    expect(eventModel.mermaid?.startsWith("flowchart LR")).toBe(true);
  });

  it("returns diagnostics and NO diagram for an invalid specification", () => {
    const result = renderFeatureBlock(
      VALID_FEATURE.replace("next: done", "next: nowhere"),
      { view: "flow", direction: "TD" },
    );
    expect(result.valid).toBe(false);
    expect(result.mermaid).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toContain("LS101");
  });

  it("keeps info-level diagnostics alongside a valid diagram", () => {
    // The demo feature has no failure outcome → LS400 info.
    const result = renderFeatureBlock(VALID_FEATURE, { view: "flow", direction: "TD" });
    expect(result.valid).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "info")).toBe(true);
  });

  it("survives unparseable YAML with diagnostics only", () => {
    const result = renderFeatureBlock("version: [broken", { view: "flow", direction: "TD" });
    expect(result.valid).toBe(false);
    expect(result.mermaid).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("LS001");
  });
});
