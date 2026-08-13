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
} from "../../src/index.js";
import { renderMermaidSequence } from "../../src/renderers/mermaid-sequence.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function modelOf(source: string): { feature: NormalizedFeature; graph: FeatureGraph } {
  const parsed = parseFeature(source);
  if (!parsed.data) throw new Error(`fixture must parse: ${JSON.stringify(parsed.diagnostics)}`);
  const feature = normalizeFeature(parsed.data);
  return { feature, graph: buildGraph(feature) };
}

function bookingModel(): { feature: NormalizedFeature; graph: FeatureGraph } {
  const source = fs.readFileSync(path.join(ROOT, "examples/booking/booking.feature.yaml"), "utf8");
  return modelOf(source);
}

describe("mermaid sequence renderer (experimental)", () => {
  it("renders the booking example deterministically (golden)", () => {
    const { feature, graph } = bookingModel();
    const first = renderMermaidSequence(feature, graph);
    expect(first).toBe(renderMermaidSequence(feature, graph));
    expect(first.startsWith("sequenceDiagram")).toBe(true);
    expect(first).toMatchSnapshot();
  });

  it("declares only used actors plus an Unassigned participant", () => {
    const { feature, graph } = bookingModel();
    const output = renderMermaidSequence(feature, graph);
    expect(output).toContain("participant frontend as Web App");
    expect(output).toContain("participant booking as Booking Service");
    expect(output).toContain("participant payment as Payment Service");
    // customer and pubsub are declared but never assigned to a step.
    expect(output).not.toContain("participant customer");
    expect(output).not.toContain("participant pubsub");
    expect(output).toContain("as Unassigned");
  });

  it("emits one message per transition with actor-to-actor routing", () => {
    const { feature, graph } = bookingModel();
    const output = renderMermaidSequence(feature, graph);
    // page action within the same actor
    expect(output).toContain("frontend->>frontend: Select service");
    // operation outcome crossing actors
    expect(output).toContain("booking->>frontend: available");
    // publish note before the event step's outgoing message
    expect(output).toContain("Note over booking: publishes BookingCreated");
  });

  it("renders waits and event waits as notes with dotted arrows", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: w, name: Waits }
start: wait-pay
actors:
  booking: { kind: service, label: Booking }
steps:
  wait-pay:
    type: event
    direction: wait
    event: PaymentCompleted
    actor: booking
    timeout: 15m
    on:
      received: { next: hold }
      timeout: { next: expired }
  hold:
    type: wait
    duration: 10m
    actor: booking
    next: fin
  expired:
    type: error
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaidSequence(feature, graph);
    expect(output).toContain("Note over booking: waits for PaymentCompleted");
    expect(output).toContain("Note over booking: waits 10m");
    expect(output).toContain("--)");
    expect(output).toContain("booking--)booking: received");
  });

  it("escapes message text and sanitizes participant displays", () => {
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: esc, name: Escapes }
start: tricky
actors:
  weird: { kind: system, label: "Sys: core; edge" }
steps:
  tricky:
    type: page
    actor: weird
    actions:
      go:
        label: 'Click "here"; now <fast>'
        next: fin
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaidSequence(feature, graph);
    expect(output).toContain("participant weird as Sys- core, edge");
    expect(output).toContain("Click #quot;here#quot;, now #lt;fast#gt;");
    // No raw quotes or angle brackets survive in message text.
    expect(output).not.toContain('"here"');
    expect(output).not.toContain("<fast>");
  });

  it("normalizes a carriage return in an actor label so a \\r%% payload cannot inject a line", () => {
    // The double-quoted YAML escape "\\r" parses to a real CR (U+000D). The
    // sequence renderer normalizes participant display names with its own
    // regex (not the shared escapeMermaid), so this exercises that path
    // specifically: without bare-\r handling, a `\r?\n`-only regex leaves the
    // CR intact and a downstream `%%` opens a fresh Mermaid comment line.
    const { feature, graph } = modelOf(`
version: "1"
feature: { id: cr, name: CarriageReturn }
start: tricky
actors:
  weird: { kind: system, label: "Sys 50%%\\r%%{init} core" }
steps:
  tricky:
    type: page
    actor: weird
    actions:
      go:
        label: "before 10%%\\r%%{init} after"
        next: fin
  fin:
    type: final
    outcome: success
`);
    const output = renderMermaidSequence(feature, graph);
    // No raw carriage return survives anywhere in the output — neither in the
    // unquoted participant declaration nor in the escaped message text.
    expect(output).not.toContain("\r");
    expect(output).toContain("participant weird as Sys 50%% %%{init} core");
    expect(output).toContain("before 10#37;#37; #37;#37;{init} after");
  });
});
