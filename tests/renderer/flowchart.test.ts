import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraph,
  type FeatureGraph,
  type NormalizedFeature,
  normalizeFeature,
  parseFeature,
  renderMermaid,
} from "../../src/index.js";
import { escapeMermaid } from "../../src/renderers/mermaid-common.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function bookingModel(): { feature: NormalizedFeature; graph: FeatureGraph } {
  const source = fs.readFileSync(path.join(ROOT, "examples/booking/booking.feature.yaml"), "utf8");
  const parsed = parseFeature(source);
  if (!parsed.data) throw new Error("booking example must parse");
  const feature = normalizeFeature(parsed.data);
  return { feature, graph: buildGraph(feature) };
}

function modelOf(source: string): { feature: NormalizedFeature; graph: FeatureGraph } {
  const parsed = parseFeature(source);
  if (!parsed.data) throw new Error(`fixture must parse: ${JSON.stringify(parsed.diagnostics)}`);
  const feature = normalizeFeature(parsed.data);
  return { feature, graph: buildGraph(feature) };
}

describe("mermaid flowchart renderer", () => {
  it("renders the booking example deterministically (golden)", () => {
    const { feature, graph } = bookingModel();
    const first = renderMermaid(feature, graph, { view: "flow", direction: "TD" });
    const second = renderMermaid(feature, graph, { view: "flow", direction: "TD" });
    expect(first).toBe(second);
    expect(first).toMatchSnapshot();
  });

  it("honors the direction option", () => {
    const { feature, graph } = bookingModel();
    expect(renderMermaid(feature, graph, { direction: "LR" }).startsWith("flowchart LR")).toBe(
      true,
    );
  });

  it("escapes quotes, angle brackets, ampersands, hashes and unicode in labels", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: esc, name: Escapes }
start: tricky
steps:
  tricky:
    type: page
    label: 'He said "hi" & left (fast) <b>#1</b> — café ⚡'
    actions:
      go:
        label: 'Click "here" & <go>'
        next: fin
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaid(feature, graph);
    expect(output).toContain(
      "He said #quot;hi#quot; #amp; left (fast) #lt;b#gt;#35;1#lt;/b#gt; — café ⚡",
    );
    expect(output).toContain('-- "Click #quot;here#quot; #amp; #lt;go#gt;" -->');
    expect(output).not.toMatch(/[^#]"hi"/); // no raw unescaped quotes inside labels
  });

  it("neutralizes a %% comment token in labels so it cannot break the diagram", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: pct, name: Percent }
start: tricky
steps:
  tricky:
    type: page
    label: 'Discount 50%% off %%{init}'
    actions:
      go:
        label: 'apply 10%% %% now'
        next: fin
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaid(feature, graph);
    // Every "%" is rendered as the literal entity code, so no "%%" survives.
    expect(output).not.toContain("%");
    expect(output).toContain("Discount 50#37;#37; off #37;#37;{init}");
    expect(output).toContain('-- "apply 10#37;#37; #37;#37; now" -->');
  });

  it("normalizes a carriage return in labels so a \\r%% payload cannot inject a line", () => {
    // The double-quoted YAML escape "\\r" parses to a real CR (U+000D). Without
    // CR normalization it would start a fresh Mermaid line that begins with "%%",
    // opening a comment; with it, the CR collapses to a space on the same line.
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: cr, name: CarriageReturn }
start: tricky
steps:
  tricky:
    type: page
    label: "before 50%%\\r%%{init} after"
    actions:
      go: { next: fin }
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaid(feature, graph);
    // No raw carriage return survives anywhere in the output.
    expect(output).not.toContain("\r");
    // The CR collapsed to a space and every "%" is neutralized, so the payload
    // stays inert text on a single line (no injected "%%" comment line).
    expect(output).not.toContain("%");
    expect(output).toContain("before 50#37;#37; #37;#37;{init} after");
  });

  it("collapses every newline form (\\n, bare \\r, \\r\\n) to a single space in escapeMermaid", () => {
    expect(escapeMermaid("a\nb")).toBe("a b");
    expect(escapeMermaid("a\rb")).toBe("a b");
    expect(escapeMermaid("a\r\nb")).toBe("a b");
    // A CR immediately before a comment token cannot survive to open a line.
    expect(escapeMermaid("x\r%%y")).not.toContain("\r");
    expect(escapeMermaid("x\r%%y")).not.toContain("%");
  });

  it("never emits reserved words or unsafe characters as node ids", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: ids, name: Ids }
start: end-of-flow
steps:
  end-of-flow:
    type: page
    actions:
      go: { next: End }
  End:
    type: final
    outcome: success
`);
    const output = renderMermaid(feature, graph);
    // "end" is reserved in mermaid flowcharts; ids must be sanitized and unique.
    const idLines = output
      .split("\n")
      .filter((line) => line.includes("PAGE") || line.includes("FINAL"));
    expect(idLines.every((line) => !/^\s*end[\s[]/.test(line))).toBe(true);
    expect(output).toContain("end_of_flow");
  });

  it("marks normal, error and terminate finals with distinct markers (finalKind)", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: terminals, name: Terminals }
start: d
steps:
  d:
    type: decision
    cases:
      - { when: ok, next: done }
      - { when: bad, next: failed }
      - { when: stop, next: halted }
  done: { type: final, outcome: success }
  failed: { type: final, outcome: failure }
  halted: { type: final, outcome: failure, terminate: true }
`);
    const output = renderMermaid(feature, graph);
    // Error terminal: a failure outcome with no terminate.
    expect(output).toContain("FINAL · failure · ⊗ ERROR");
    // Terminate wins over the error branch.
    expect(output).toContain("FINAL · failure · ⦻ TERMINATE");
    // Normal terminal carries no error/terminate marker.
    expect(output).toContain("FINAL · success");
    expect(output).not.toContain("FINAL · success · ⊗");
    expect(output).not.toContain("FINAL · success · ⦻");
    expect(output).toMatchSnapshot();
  });

  it("uses distinct shapes per step type", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: shapes, name: Shapes }
start: p
steps:
  p: { type: page, actions: { go: { next: d } } }
  d:
    type: decision
    cases: [{ when: ok, next: o }]
  o: { type: operation, next: w }
  w: { type: wait, duration: 5m, next: par }
  par:
    type: parallel
    branches: { a: { flow: other } }
    next: e
  e: { type: error, actions: { retry: { next: p }, quit: { next: f } } }
  f: { type: final, outcome: cancelled }
`);
    const output = renderMermaid(feature, graph);
    expect(output).toContain('p["'); // rectangle
    expect(output).toContain('d{"'); // diamond
    expect(output).toContain('o[["'); // subroutine
    expect(output).toContain('w(["'); // stadium
    expect(output).toContain('par[/"'); // parallelogram
    expect(output).toContain(":::error"); // marked error
    expect(output).toContain('f((("'); // double circle
  });

  it("renders a details marker line — and never an edge — for detail flows", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: d, name: D }
start: p
steps:
  p:
    type: page
    details: [send-email, send-sms]
    actions: { go: { next: f } }
  f: { type: final, outcome: success }
`);
    const output = renderMermaid(feature, graph);
    expect(output).toContain("» details: send-email, send-sms");
    // Refinement links are documentation: no graph edge may point at them.
    expect(output).not.toContain("send_email");
    expect(graph.edges).toHaveLength(1); // only p→f; details add no edges
  });
});
