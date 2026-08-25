import { describe, expect, it } from "vitest";
import { actorColor, layout } from "../../client/src/pages/feature-detail/Canvas.js";

describe("actorColor", () => {
  it("returns a stable, deterministic value for the same actor id across calls", () => {
    expect(actorColor("frontend")).toBe(actorColor("frontend"));
    expect(actorColor("booking")).toBe(actorColor("booking"));
  });

  it("maps different actor ids to different colors", () => {
    expect(actorColor("frontend")).not.toBe(actorColor("booking"));
    expect(actorColor("frontend")).not.toBe(actorColor("payment"));
  });
});

describe("layout", () => {
  const steps = [
    { id: "a", label: "A", type: "page" },
    { id: "b", label: "B", type: "operation" },
    { id: "c", label: "C", type: "final" },
  ];
  const edges = [
    { from: "a", to: "b", kind: "next" },
    { from: "b", to: "c", kind: "next" },
  ];

  it("returns a node for each input step, with a computed position", () => {
    const nodes = layout(steps, edges);
    expect(nodes).toHaveLength(steps.length);
    for (const node of nodes) {
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
      expect(Number.isNaN(node.position.x)).toBe(false);
      expect(Number.isNaN(node.position.y)).toBe(false);
    }
  });

  it("preserves step order and ids in the output", () => {
    const nodes = layout(steps, edges);
    expect(nodes.map((n) => n.id)).toEqual(steps.map((s) => s.id));
  });

  it("handles a single step with no edges", () => {
    const nodes = layout([{ id: "only", label: "Only", type: "page" }], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe("only");
  });
});
