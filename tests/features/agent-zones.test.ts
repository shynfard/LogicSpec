import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGraph,
  createMcpHandler,
  inspectFeature,
  normalizeFeature,
  parseFeature,
  renderMermaid,
  validateFeature,
} from "../../src/index.js";
import type { JsonRpcResponse, McpToolResult } from "../../src/mcp/protocol.js";
import { featureWith } from "../helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** A small, fully-valid flow: start → analyze → decide → {done|failed}. */
function baseSteps(): string {
  return `  start-step:
    type: operation
    call: svc.begin
    next: analyze
  analyze:
    type: operation
    call: svc.analyze
    next: decide
  decide:
    type: decision
    cases:
      - when: looks good
        next: done
    default:
      next: failed
  done:
    type: final
    outcome: success
  failed:
    type: final
    outcome: failure`;
}

/** Wraps the base flow with a top-level `zones:` block. */
function withZones(zonesYaml: string): string {
  return featureWith(baseSteps(), zonesYaml);
}

/** Full-pipeline diagnostic codes (structural + semantic) for a source string. */
function allCodes(source: string): string[] {
  return validateFeature(source).diagnostics.map((d) => d.code);
}

/** Structural (file-local) diagnostic codes for a source string. */
function structuralCodes(source: string): string[] {
  return parseFeature(source).diagnostics.map((d) => d.code);
}

describe("agent actor kind", () => {
  it("accepts an actor declared with kind: agent", () => {
    const source = `
version: "1"
feature: { id: a, name: Agent }
start: work
actors:
  bot:
    kind: agent
    label: Bot
steps:
  work:
    type: decision
    actor: bot
    cases:
      - when: handled
        next: done
    default:
      next: failed
  done:
    type: final
    outcome: success
  failed:
    type: final
    outcome: failure
`;
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    // The agent actor reads as its own swimlane lane, like any other actor kind.
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const swimlane = renderMermaid(feature, buildGraph(feature), { view: "swimlane" });
    expect(swimlane).toContain("Bot (agent)");
  });
});

describe("agent zones — valid (LS309)", () => {
  it("accepts a zone over real steps with no diagnostics", () => {
    const source = withZones(`zones:
  - label: Agent Region
    description: The agent drives this stretch.
    steps:
      - analyze
      - decide`);
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('defaults a zone kind to "agent" when omitted', () => {
    const source = withZones(`zones:
  - label: Region
    steps: [analyze]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    expect(feature.zones).toHaveLength(1);
    expect(feature.zones[0]?.kind).toBe("agent");
  });

  it("accepts two zones over disjoint steps", () => {
    const source = withZones(`zones:
  - label: First
    steps: [analyze]
  - label: Second
    steps: [decide]`);
    expect(validateFeature(source).diagnostics).toEqual([]);
  });
});

describe("agent zones — invalid (LS309)", () => {
  it("rejects a zone referencing an unknown step, with a suggestion", () => {
    const source = withZones(`zones:
  - label: Region
    steps: [analyse]`);
    const diagnostics = parseFeature(source).diagnostics;
    const zone = diagnostics.find((d) => d.code === "LS309");
    expect(zone).toBeDefined();
    expect(zone?.message).toContain("analyse");
    expect(zone?.message).toContain('Did you mean "analyze"?');
  });

  it("rejects a step that belongs to two zones (overlap disallowed)", () => {
    const source = withZones(`zones:
  - label: First
    steps: [analyze, decide]
  - label: Second
    steps: [decide]`);
    const diagnostics = parseFeature(source).diagnostics;
    const overlap = diagnostics.find(
      (d) => d.code === "LS309" && d.message.includes("at most one zone"),
    );
    expect(overlap).toBeDefined();
    expect(overlap?.message).toContain('"decide"');
  });

  it("rejects an empty zone (no steps)", () => {
    const source = withZones(`zones:
  - label: Empty
    steps: []`);
    const diagnostics = structuralCodes(source);
    expect(diagnostics).toContain("LS309");
  });
});

describe("agent zones — resource bounds (LS309 DoS guard)", () => {
  it("rejects an over-limit zones array with LS309, not a hang", () => {
    const zones = Array.from(
      { length: 101 },
      (_, i) => `  - label: Z${i}\n    steps: [analyze]`,
    ).join("\n");
    const source = withZones(`zones:\n${zones}`);
    const started = Date.now();
    const result = validateFeature(source);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.valid).toBe(false);
    expect(
      result.diagnostics.some(
        (d) => d.code === "LS309" && d.message.includes("more than 100 agent zones"),
      ),
    ).toBe(true);
  });

  it("rejects an over-limit steps-per-zone array with LS309", () => {
    const steps = Array.from({ length: 1001 }, () => "analyze").join(", ");
    const source = withZones(`zones:
  - label: Big
    steps: [${steps}]`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(
      diagnostics.some((d) => d.code === "LS309" && d.message.includes("more than 1000 steps")),
    ).toBe(true);
  });

  it("rejects an over-long zone label with LS309", () => {
    const source = withZones(`zones:
  - label: "${"x".repeat(201)}"
    steps: [analyze]`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS309" && d.message.includes("characters"))).toBe(
      true,
    );
  });

  it("rejects an over-long zone description with LS309", () => {
    const source = withZones(`zones:
  - label: Region
    description: "${"x".repeat(1001)}"
    steps: [analyze]`);
    const diagnostics = parseFeature(source).diagnostics;
    expect(diagnostics.some((d) => d.code === "LS309" && d.message.includes("characters"))).toBe(
      true,
    );
  });
});

describe("agent zones — model & graph exposure", () => {
  it("exposes zones on the normalized model and annotates step membership", () => {
    const source = withZones(`zones:
  - label: Agent Region
    steps: [analyze, decide]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());

    expect(feature.zones).toEqual([
      {
        label: "Agent Region",
        description: undefined,
        kind: "agent",
        steps: ["analyze", "decide"],
      },
    ]);
    expect(feature.steps.find((s) => s.id === "analyze")?.zone).toBe("Agent Region");
    expect(feature.steps.find((s) => s.id === "decide")?.zone).toBe("Agent Region");
    expect(feature.steps.find((s) => s.id === "start-step")?.zone).toBeUndefined();
  });

  it("exposes zones on the graph model", () => {
    const source = withZones(`zones:
  - label: Agent Region
    steps: [analyze, decide]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const graph = buildGraph(feature);
    expect(graph.zones).toEqual([
      {
        label: "Agent Region",
        description: undefined,
        kind: "agent",
        steps: ["analyze", "decide"],
      },
    ]);
  });

  it("surfaces zones and per-step membership through inspect", () => {
    const source = withZones(`zones:
  - label: Agent Region
    steps: [analyze, decide]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const report = inspectFeature(feature, buildGraph(feature));
    expect(report.zones).toEqual([
      { label: "Agent Region", kind: "agent", steps: ["analyze", "decide"] },
    ]);
    expect(report.steps.find((s) => s.id === "analyze")?.zone).toBe("Agent Region");
    expect(report.steps.find((s) => s.id === "start-step")?.zone).toBeUndefined();
  });
});

describe("agent zones — rendering", () => {
  it("renders a zone as a labelled subgraph cluster in the flowchart", () => {
    const source = withZones(`zones:
  - label: Agent Region
    steps: [analyze, decide]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });

    expect(output).toContain('subgraph zone_0["🤖 Agent Region"]');
    expect(output).toContain("  end");
    // Members are declared inside the cluster; a non-member stays at top level.
    const clusterStart = output.indexOf("subgraph zone_0");
    const clusterEnd = output.indexOf("  end", clusterStart);
    const cluster = output.slice(clusterStart, clusterEnd);
    expect(cluster).toContain("analyze");
    expect(cluster).toContain("decide");
    expect(cluster).not.toContain("start_step");
    // Edges still cross the cluster boundary normally.
    expect(output).toContain("start_step --> analyze");
    expect(output).toMatchSnapshot();
  });

  it("renders identically to the zone-free flowchart when no zones are declared", () => {
    const withoutZones = featureWith(baseSteps());
    const feature = normalizeFeature(parseFeature(withoutZones).data ?? never());
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });
    expect(output).not.toContain("subgraph");
  });

  it("keeps swimlane/sequence/event-model non-crashing when zones are present", () => {
    const source = withZones(`zones:
  - label: Agent Region
    steps: [analyze, decide]`);
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const graph = buildGraph(feature);
    for (const view of ["swimlane", "sequence", "event-model"] as const) {
      expect(() => renderMermaid(feature, graph, { view })).not.toThrow();
    }
  });
});

describe("agent zones — MCP awareness", () => {
  let dir: string;

  const CONFIG = `version: "1"
features:
  directory: ./features
`;
  const FEATURE = `version: "1"
feature: { id: triage, name: Triage }
start: intake
actors:
  bot: { kind: agent, label: Bot }
steps:
  intake:
    type: operation
    actor: bot
    call: svc.intake
    next: assess
  assess:
    type: operation
    actor: bot
    call: svc.assess
    next: done
  done:
    type: final
    outcome: success
zones:
  - label: AI Region
    steps: [intake, assess]
`;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-zones-"));
    fs.mkdirSync(path.join(dir, "features"));
    fs.writeFileSync(path.join(dir, "logicspec.config.yaml"), CONFIG);
    fs.writeFileSync(path.join(dir, "features", "triage.feature.yaml"), FEATURE);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function call(name: string, args: unknown): Promise<McpToolResult> {
    const handler = createMcpHandler({ rootDir: dir, serverVersion: "test" });
    const response = (await handler({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    })) as JsonRpcResponse;
    if (!("result" in response)) throw new Error(`expected result: ${JSON.stringify(response)}`);
    return response.result as McpToolResult;
  }

  it("get_step surfaces the zone a step belongs to", async () => {
    const result = await call("get_step", { feature: "triage", step: "intake" });
    expect(result.isError).toBeUndefined();
    const step = JSON.parse(result.content[0]?.text ?? "{}") as { id: string; zone?: string };
    expect(step.id).toBe("intake");
    expect(step.zone).toBe("AI Region");
  });

  it("get_feature exposes the feature's agent zones", async () => {
    const result = await call("get_feature", { feature: "triage" });
    const report = JSON.parse(result.content[0]?.text ?? "{}") as {
      zones: Array<{ label: string; kind: string; steps: string[] }>;
    };
    expect(report.zones).toEqual([
      { label: "AI Region", kind: "agent", steps: ["intake", "assess"] },
    ]);
  });
});

describe("agent-zones example (examples/triage)", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "examples/triage/incident-triage.feature.yaml"),
    "utf8",
  );

  it("validates with no diagnostics at all", () => {
    const result = validateFeature(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("renders the AI Triage zone as a subgraph cluster (golden)", () => {
    const feature = normalizeFeature(parseFeature(source).data ?? never());
    const output = renderMermaid(feature, buildGraph(feature), { view: "flow", direction: "TD" });
    expect(output).toContain('subgraph zone_0["🤖 AI Triage"]');
    expect(output).toContain("classify");
    expect(allCodes(source)).toEqual([]);
    expect(output).toMatchSnapshot();
  });
});

/** Narrowing helper for `parseFeature(...).data` in tests. */
function never(): never {
  throw new Error("fixture must parse");
}
