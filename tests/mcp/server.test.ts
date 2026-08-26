import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  JsonRpcErrorResponse,
  JsonRpcResponse,
  McpToolDescriptor,
  McpToolResult,
} from "../../src/mcp/protocol.js";
import { createMcpHandler } from "../../src/mcp/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

const handler = createMcpHandler({ rootDir: BOOKING, serverVersion: "test" });

let nextId = 1;

function request(method: string, params?: unknown) {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

async function rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const response = await handler(request(method, params));
  if (response === undefined) throw new Error(`expected a response for ${method}`);
  return response;
}

function resultOf(response: JsonRpcResponse): unknown {
  if (!("result" in response)) {
    throw new Error(`expected success, got ${JSON.stringify(response)}`);
  }
  return response.result;
}

function errorOf(response: JsonRpcResponse): JsonRpcErrorResponse["error"] {
  if (!("error" in response)) {
    throw new Error(`expected error, got ${JSON.stringify(response)}`);
  }
  return response.error;
}

async function callTool(name: string, args?: unknown): Promise<McpToolResult> {
  return resultOf(await rpc("tools/call", { name, arguments: args })) as McpToolResult;
}

function toolPayload<T>(result: McpToolResult): T {
  expect(result.isError).toBeUndefined();
  const text = result.content[0]?.text ?? "";
  return JSON.parse(text) as T;
}

describe("MCP handshake", () => {
  it("echoes a supported protocolVersion on initialize", async () => {
    const result = resultOf(
      await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      }),
    ) as {
      protocolVersion: string;
      capabilities: { tools?: unknown };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.capabilities.tools).toBeDefined();
    expect(result.serverInfo).toEqual({ name: "logicspec", version: "test" });
  });

  it("falls back to the latest supported version for unknown requests", async () => {
    const result = resultOf(await rpc("initialize", { protocolVersion: "1999-01-01" })) as {
      protocolVersion: string;
    };
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("acknowledges notifications/initialized silently", async () => {
    const response = await handler({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response).toBeUndefined();
  });

  it("ignores unknown notifications and stray responses", async () => {
    expect(await handler({ jsonrpc: "2.0", method: "notifications/cancelled" })).toBeUndefined();
    expect(await handler({ jsonrpc: "2.0", id: 99, result: {} })).toBeUndefined();
  });

  it("answers ping with an empty result", async () => {
    expect(resultOf(await rpc("ping"))).toEqual({});
  });

  it("rejects non-object messages", async () => {
    const response = (await handler(42)) as JsonRpcResponse;
    expect(errorOf(response).code).toBe(-32600);
  });

  it("rejects unknown methods", async () => {
    expect(errorOf(await rpc("resources/list")).code).toBe(-32601);
  });
});

describe("tools/list", () => {
  it("lists exactly the ten workspace tools with object schemas", async () => {
    const { tools } = resultOf(await rpc("tools/list")) as { tools: McpToolDescriptor[] };
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_features",
      "get_feature",
      "get_step",
      "get_transitions",
      "get_service_dependencies",
      "get_events",
      "validate_feature",
      "render_feature",
      "diff_feature",
      "get_data_flow",
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("tools/call", () => {
  it("list_features includes the booking feature", async () => {
    const features = toolPayload<Array<{ id: string; file: string; name: string; valid: boolean }>>(
      await callTool("list_features"),
    );
    const booking = features.find((feature) => feature.id === "booking");
    expect(booking).toBeDefined();
    expect(booking?.file).toBe("booking.feature.yaml");
    expect(booking?.name).toBe("Booking");
    expect(booking?.valid).toBe(true);
  });

  it("get_feature returns the inspect report", async () => {
    const report = toolPayload<{ feature: string; start: string; valid: boolean; file: string }>(
      await callTool("get_feature", { feature: "booking" }),
    );
    expect(report.feature).toBe("booking");
    expect(report.start).toBe("select-service");
    expect(report.valid).toBe(true);
    expect(report.file).toBe("booking.feature.yaml");
  });

  it("get_step returns the step definition and transitions", async () => {
    const step = toolPayload<{ id: string; type: string; transitions: unknown[] }>(
      await callTool("get_step", { feature: "booking", step: "reserve-slot" }),
    );
    expect(step.id).toBe("reserve-slot");
    expect(step.type).toBe("operation");
    expect(step.transitions).toHaveLength(3);
  });

  it("get_transitions filters by from", async () => {
    const edges = toolPayload<Array<{ from: string; to: string }>>(
      await callTool("get_transitions", { feature: "booking", from: "check-availability" }),
    );
    expect(edges).toHaveLength(3);
    expect(edges.every((edge) => edge.from === "check-availability")).toBe(true);
  });

  it("get_service_dependencies reports operations for one feature", async () => {
    const deps = toolPayload<{ feature: string; services: string[]; operations: string[] }>(
      await callTool("get_service_dependencies", { feature: "booking" }),
    );
    expect(deps.feature).toBe("booking");
    expect(deps.services).toContain("booking");
    expect(deps.operations).toContain("booking.reserve-slot");
  });

  it("get_service_dependencies without a feature covers the workspace", async () => {
    const all = toolPayload<Array<{ feature: string; operations: string[] }>>(
      await callTool("get_service_dependencies"),
    );
    expect(Array.isArray(all)).toBe(true);
    expect(all.find((entry) => entry.feature === "booking")?.operations).toContain(
      "booking.create-booking",
    );
  });

  it("get_events enriches from the event catalog", async () => {
    const events = toolPayload<
      Array<{ event: string; published: boolean; waited: boolean; topic?: string }>
    >(await callTool("get_events", { feature: "booking" }));
    const created = events.find((event) => event.event === "BookingCreated");
    expect(created).toBeDefined();
    expect(created?.published).toBe(true);
    expect(created?.topic).toBe("booking.created");
  });

  it("validate_feature returns validity and diagnostics", async () => {
    const report = toolPayload<{ feature: string; valid: boolean; diagnostics: unknown[] }>(
      await callTool("validate_feature", { feature: "booking" }),
    );
    expect(report.feature).toBe("booking");
    expect(report.valid).toBe(true);
    expect(Array.isArray(report.diagnostics)).toBe(true);
  });

  it("validate_feature matches the CLI: severity overrides apply, workspace findings included", async () => {
    // The booking workspace config turns LS402 (unused actor) off. The CLI
    // honors that; the MCP answer must too, or agents and CI disagree.
    const report = toolPayload<{
      diagnostics: Array<{ code: string }>;
      workspaceDiagnostics: Array<{ code: string }>;
    }>(await callTool("validate_feature", { feature: "booking" }));
    expect(report.diagnostics.some((d) => d.code === "LS402")).toBe(false);
    expect(Array.isArray(report.workspaceDiagnostics)).toBe(true);
  });

  it("render_feature returns Mermaid for the requested view", async () => {
    const report = toolPayload<{ feature: string; view: string; mermaid: string }>(
      await callTool("render_feature", { feature: "booking", view: "sequence" }),
    );
    expect(report.view).toBe("sequence");
    expect(report.mermaid).toContain("sequenceDiagram");
    const flow = toolPayload<{ view: string; mermaid: string }>(
      await callTool("render_feature", { feature: "booking" }),
    );
    expect(flow.view).toBe("flow");
    expect(flow.mermaid).toContain("flowchart");
  });

  it("diff_feature reports semantic changes against a proposed source", async () => {
    const original = fs.readFileSync(path.join(BOOKING, "booking.feature.yaml"), "utf8");
    const identical = toolPayload<{ identical: boolean }>(
      await callTool("diff_feature", { feature: "booking", proposed_source: original }),
    );
    expect(identical.identical).toBe(true);

    const renamed = original.replace("label: Select Service", "label: Pick a Service");
    const changed = toolPayload<{ identical: boolean; summary: string }>(
      await callTool("diff_feature", { feature: "booking", proposed_source: renamed }),
    );
    expect(changed.identical).toBe(false);
    expect(changed.summary).toContain("select-service");
  });

  it("diff_feature rejects an unparseable proposal as a tool error", async () => {
    const result = await callTool("diff_feature", {
      feature: "booking",
      proposed_source: "not: [valid",
    });
    expect(result.isError).toBe(true);
  });

  it("get_data_flow maps producers and consumers of a context key", async () => {
    const flow = toolPayload<{ key: string; producedBy: string[]; requiredBy: string[] }>(
      await callTool("get_data_flow", { feature: "booking", key: "selectedService" }),
    );
    expect(flow.producedBy).toContain("select-service.select");
    expect(flow.requiredBy).toContain("select-staff");
    const all = toolPayload<Array<{ key: string }>>(
      await callTool("get_data_flow", { feature: "booking" }),
    );
    expect(all.map((f) => f.key)).toContain("reservationId");
  });

  it("reports unknown features as tool errors, not protocol errors", async () => {
    const result = await callTool("get_feature", { feature: "nope" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"nope"');
    expect(result.content[0]?.text).toContain("booking");
  });

  it("rejects unknown tools with -32602", async () => {
    expect(errorOf(await rpc("tools/call", { name: "does_not_exist" })).code).toBe(-32602);
  });

  it("rejects invalid arguments with -32602", async () => {
    const error = errorOf(
      await rpc("tools/call", { name: "get_step", arguments: { feature: "booking" } }),
    );
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("step");
  });
});
