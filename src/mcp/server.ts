import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { diffFeatures, formatFeatureDiff } from "../diff/diff.js";
import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import { inspectFeature } from "../inspect.js";
import { renderMermaid } from "../renderers/markdown.js";
import type { EventsFile } from "../schema/events.js";
import { validateCatalogs } from "../validator/catalogs.js";
import {
  applySeverityOverrides,
  type ValidationResult,
  validateFeature,
} from "../validator/validate.js";
import {
  FEATURE_FILE_SUFFIX,
  featureStem,
  loadWorkspace,
  type Workspace,
  type WorkspaceFeatureRef,
} from "../workspace/loader.js";
import {
  ERROR_CODES,
  errorResponse,
  type JsonRpcId,
  type JsonRpcResponse,
  LATEST_PROTOCOL_VERSION,
  type McpToolDescriptor,
  type McpToolResult,
  SUPPORTED_PROTOCOL_VERSIONS,
  successResponse,
} from "./protocol.js";

export interface McpServerOptions {
  /** Directory of (or inside) the LogicSpec workspace to expose. */
  rootDir: string;
  /** Reported in the initialize handshake. */
  serverVersion: string;
}

export type McpHandler = (message: unknown) => Promise<JsonRpcResponse | undefined>;

/** A tool-level failure: reported as an isError result, not a protocol error. */
class ToolError extends Error {}

interface ToolContext {
  workspace: Workspace;
  rootDir: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  /** Human-readable argument list for docs surfaces (the dashboard MCP page). */
  argsSummary: string;
  schema: z.ZodType;
  run: (args: unknown, context: ToolContext) => unknown;
}

// ── Workspace helpers ────────────────────────────────────────────────────────

interface FeatureEntry {
  id: string;
  /** Path relative to the workspace root directory. */
  file: string;
  name: string;
  result: ValidationResult;
}

function requireWorkspace(context: ToolContext): Workspace {
  if (context.workspace.configPath === undefined) {
    throw new ToolError(
      `No logicspec.config.yaml found at or above ${context.rootDir}. ` +
        "Point the server at a LogicSpec workspace directory.",
    );
  }
  return context.workspace;
}

function fallbackId(ref: WorkspaceFeatureRef): string {
  return ref.id ?? featureStem(ref.path);
}

function loadFeatureEntry(ref: WorkspaceFeatureRef, context: ToolContext): FeatureEntry {
  const { workspace } = context;
  const file = path.relative(context.rootDir, ref.path) || path.basename(ref.path);
  let source: string;
  try {
    source = fs.readFileSync(ref.path, "utf8");
  } catch (error) {
    throw new ToolError(`Cannot read ${file}: ${(error as Error).message}`);
  }
  // Exactly the options the CLI's validateTarget passes — an agent asking
  // over MCP must get the same verdict as `logicspec validate` in CI,
  // including flow-outcome contracts and the workspace's severity overrides.
  const result = validateFeature(source, {
    file,
    services: workspace.services,
    events: workspace.events,
    definitions: workspace.definitions,
    knownFlows: workspace.knownFlows,
    flowOutcomes: workspace.flowOutcomes,
    severityOverrides: workspace.config.diagnostics,
  });
  const id = fallbackId(ref);
  return { id, file, name: result.feature?.feature.name ?? id, result };
}

function resolveFeature(query: string, context: ToolContext): FeatureEntry {
  const workspace = requireWorkspace(context);
  const ref = workspace.features.find(
    (candidate) => candidate.id === query || featureStem(candidate.path) === query,
  );
  if (!ref) {
    const known = workspace.features.map(fallbackId).sort().join(", ");
    throw new ToolError(
      `Unknown feature "${query}". Known features: ${known || "(none)"}. ` +
        `Features are *${FEATURE_FILE_SUFFIX} files in the workspace's features directory.`,
    );
  }
  return loadFeatureEntry(ref, context);
}

function requireModel(entry: FeatureEntry): {
  normalized: NormalizedFeature;
  graph: FeatureGraph;
} {
  const { normalized, graph } = entry.result;
  if (!normalized || !graph) {
    const firstError = entry.result.diagnostics.find((d) => d.severity === "error");
    throw new ToolError(
      `Feature "${entry.id}" (${entry.file}) does not parse: ` +
        `${firstError?.message ?? "unknown error"} Use validate_feature for full diagnostics.`,
    );
  }
  return { normalized, graph };
}

interface EventUsage {
  event: string;
  published: boolean;
  waited: boolean;
  topic?: string;
  producer?: string;
  consumers?: string[];
  description?: string;
}

function eventsOf(normalized: NormalizedFeature, catalog: EventsFile | undefined): EventUsage[] {
  const usage = new Map<string, EventUsage>();
  for (const step of normalized.steps) {
    if (step.def.type !== "event") continue;
    const name = step.def.event;
    if (name === undefined) continue; // timer/error/conditional events name no catalog event
    const entry = usage.get(name) ?? {
      event: name,
      published: false,
      waited: false,
    };
    if (step.def.direction === "publish") entry.published = true;
    else entry.waited = true;
    usage.set(name, entry);
  }
  return [...usage.values()].map((entry) => {
    const def = catalog?.events[entry.event];
    if (!def) return entry;
    return {
      ...entry,
      topic: def.topic,
      producer: def.producer,
      consumers: def.consumers,
      description: def.description,
    };
  });
}

function dependenciesOf(ref: WorkspaceFeatureRef, context: ToolContext) {
  try {
    const entry = loadFeatureEntry(ref, context);
    if (entry.result.normalized && entry.result.graph) {
      const report = inspectFeature(entry.result.normalized, entry.result.graph);
      return { feature: entry.id, services: report.services, operations: report.operations };
    }
    return { feature: entry.id, services: [], operations: [] };
  } catch {
    return { feature: fallbackId(ref), services: [], operations: [] };
  }
}

// ── Tools ────────────────────────────────────────────────────────────────────

const featureArg = z
  .string()
  .describe('Feature id or file stem within the workspace, e.g. "booking".');

const TOOLS: ToolDefinition[] = [
  {
    name: "list_features",
    argsSummary: "—",
    description:
      "List every feature specification in the LogicSpec workspace: id, file, display name and " +
      "whether it currently validates.",
    schema: z.strictObject({}).describe("No arguments."),
    run: (_args, context) => {
      const workspace = requireWorkspace(context);
      return workspace.features.map((ref) => {
        try {
          const entry = loadFeatureEntry(ref, context);
          return { id: entry.id, file: entry.file, name: entry.name, valid: entry.result.valid };
        } catch {
          const id = fallbackId(ref);
          return {
            id,
            file: path.relative(context.rootDir, ref.path) || path.basename(ref.path),
            name: id,
            valid: false,
          };
        }
      });
    },
  },
  {
    name: "get_feature",
    argsSummary: "feature",
    description:
      "Full structured model of one feature: steps, edges, terminals, context, services, " +
      "events, agent zones and stats. This is the machine-readable source of truth for the " +
      "feature's behavior.",
    schema: z.strictObject({ feature: featureArg }),
    run: (args, context) => {
      const { feature } = args as { feature: string };
      const entry = resolveFeature(feature, context);
      const { normalized, graph } = requireModel(entry);
      return { ...inspectFeature(normalized, graph), file: entry.file, valid: entry.result.valid };
    },
  },
  {
    name: "get_step",
    argsSummary: "feature, step",
    description:
      "One step of a feature: its definition exactly as authored, every outgoing transition, and " +
      "the agent zone it belongs to (when any).",
    schema: z.strictObject({
      feature: featureArg,
      step: z.string().describe('Step id, e.g. "reserve-slot".'),
    }),
    run: (args, context) => {
      const { feature, step } = args as { feature: string; step: string };
      const entry = resolveFeature(feature, context);
      const { normalized } = requireModel(entry);
      const found = normalized.steps.find((s) => s.id === step);
      if (!found) {
        throw new ToolError(
          `Unknown step "${step}" in feature "${entry.id}". ` +
            `Steps: ${normalized.steps.map((s) => s.id).join(", ")}.`,
        );
      }
      return found;
    },
  },
  {
    name: "get_transitions",
    argsSummary: "feature, from?",
    description: "Edges of a feature's graph, optionally filtered to those leaving one step.",
    schema: z.strictObject({
      feature: featureArg,
      from: z.string().optional().describe("Only transitions leaving this step id."),
    }),
    run: (args, context) => {
      const { feature, from } = args as { feature: string; from?: string };
      const entry = resolveFeature(feature, context);
      const { normalized, graph } = requireModel(entry);
      if (from !== undefined && !normalized.steps.some((s) => s.id === from)) {
        throw new ToolError(`Unknown step "${from}" in feature "${entry.id}".`);
      }
      return from === undefined ? graph.edges : graph.edges.filter((edge) => edge.from === from);
    },
  },
  {
    name: "get_service_dependencies",
    argsSummary: "feature?",
    description:
      "Services and operations a feature calls; without a feature argument, one entry per " +
      "feature in the workspace.",
    schema: z.strictObject({ feature: featureArg.optional() }),
    run: (args, context) => {
      const { feature } = args as { feature?: string };
      if (feature !== undefined) {
        const entry = resolveFeature(feature, context);
        const { normalized, graph } = requireModel(entry);
        const report = inspectFeature(normalized, graph);
        return { feature: entry.id, services: report.services, operations: report.operations };
      }
      const workspace = requireWorkspace(context);
      return workspace.features.map((ref) => dependenciesOf(ref, context));
    },
  },
  {
    name: "get_events",
    argsSummary: "feature?",
    description:
      "Events a feature publishes or waits for, enriched from the event catalog " +
      "(topic, producer, consumers); without a feature argument, one entry per feature.",
    schema: z.strictObject({ feature: featureArg.optional() }),
    run: (args, context) => {
      const { feature } = args as { feature?: string };
      if (feature !== undefined) {
        const entry = resolveFeature(feature, context);
        const { normalized } = requireModel(entry);
        return eventsOf(normalized, context.workspace.events);
      }
      const workspace = requireWorkspace(context);
      return workspace.features.map((ref) => {
        try {
          const entry = loadFeatureEntry(ref, context);
          const events = entry.result.normalized
            ? eventsOf(entry.result.normalized, workspace.events)
            : [];
          return { feature: entry.id, events };
        } catch {
          return { feature: fallbackId(ref), events: [] };
        }
      });
    },
  },
  {
    name: "validate_feature",
    argsSummary: "feature",
    description:
      "Validate one feature against the workspace (catalogs, subflows, graph analysis, severity " +
      "overrides) and return the full diagnostics with stable LS codes — the same verdict " +
      "`logicspec validate` gives in CI, plus the workspace-level catalog findings.",
    schema: z.strictObject({ feature: featureArg }),
    run: (args, context) => {
      const { feature } = args as { feature: string };
      const workspace = requireWorkspace(context);
      const entry = resolveFeature(feature, context);
      // Catalog / API-document findings (LS108/LS109/LS403…) are workspace-
      // level, so the CLI prints them alongside every validate run; report
      // them here too or an agent never sees them.
      const workspaceFindings = applySeverityOverrides(
        [...workspace.diagnostics, ...validateCatalogs(workspace)],
        workspace.config.diagnostics,
      );
      return {
        feature: entry.id,
        file: entry.file,
        valid: entry.result.valid && !workspaceFindings.some((d) => d.severity === "error"),
        diagnostics: entry.result.diagnostics,
        workspaceDiagnostics: workspaceFindings,
      };
    },
  },
  {
    name: "render_feature",
    argsSummary: "feature, view?, direction?",
    description:
      "Mermaid source for one feature in a chosen view (flow, swimlane, sequence, event-model) " +
      "— the exact output `logicspec render --format mermaid` writes.",
    schema: z.strictObject({
      feature: featureArg,
      view: z
        .enum(["flow", "swimlane", "sequence", "event-model"])
        .optional()
        .describe("Diagram view (default: flow)."),
      direction: z
        .enum(["TD", "TB", "LR", "RL", "BT"])
        .optional()
        .describe("Flow direction (flow/swimlane views)."),
    }),
    run: (args, context) => {
      const { feature, view, direction } = args as {
        feature: string;
        view?: "flow" | "swimlane" | "sequence" | "event-model";
        direction?: "TD" | "TB" | "LR" | "RL" | "BT";
      };
      const entry = resolveFeature(feature, context);
      const { normalized, graph } = requireModel(entry);
      return {
        feature: entry.id,
        view: view ?? "flow",
        mermaid: renderMermaid(normalized, graph, { view: view ?? "flow", direction }),
      };
    },
  },
  {
    name: "diff_feature",
    argsSummary: "feature, proposed_source",
    description:
      "Semantic diff between a feature as it exists on disk and a proposed replacement YAML " +
      "source: steps and transitions added/removed/changed, context and outcome changes. Use it " +
      "to preview the behavioral impact of an edit before writing the file.",
    schema: z.strictObject({
      feature: featureArg,
      proposed_source: z.string().describe("Complete proposed feature YAML document."),
    }),
    run: (args, context) => {
      const { feature, proposed_source } = args as { feature: string; proposed_source: string };
      const workspace = requireWorkspace(context);
      const entry = resolveFeature(feature, context);
      const { normalized: before } = requireModel(entry);
      const proposed = validateFeature(proposed_source, {
        file: `${entry.file} (proposed)`,
        services: workspace.services,
        events: workspace.events,
        definitions: workspace.definitions,
        knownFlows: workspace.knownFlows,
        flowOutcomes: workspace.flowOutcomes,
        severityOverrides: workspace.config.diagnostics,
      });
      if (proposed.normalized === undefined) {
        const firstError = proposed.diagnostics.find((d) => d.severity === "error");
        throw new ToolError(
          `Proposed source does not parse: ${firstError?.message ?? "unknown error"}`,
        );
      }
      const diff = diffFeatures(before, proposed.normalized);
      return {
        feature: entry.id,
        identical: diff.identical,
        diff,
        summary: formatFeatureDiff(diff, entry.file, "proposed"),
        proposedValid: proposed.valid,
        proposedDiagnostics: proposed.diagnostics,
      };
    },
  },
  {
    name: "get_data_flow",
    argsSummary: "feature, key?",
    description:
      "Context data flow of a feature: which steps (or page actions) produce each context key " +
      "and which require it. Optionally filtered to one key.",
    schema: z.strictObject({
      feature: featureArg,
      key: z.string().optional().describe("Only this context key."),
    }),
    run: (args, context) => {
      const { feature, key } = args as { feature: string; key?: string };
      const entry = resolveFeature(feature, context);
      const { normalized } = requireModel(entry);
      const flows = new Map<string, { key: string; producedBy: string[]; requiredBy: string[] }>();
      const entryFor = (name: string) => {
        const existing = flows.get(name);
        if (existing) return existing;
        const created = { key: name, producedBy: [], requiredBy: [] };
        flows.set(name, created);
        return created;
      };
      for (const variable of normalized.context) entryFor(variable.name);
      for (const step of normalized.steps) {
        const def = step.def as {
          requires?: string[];
          produces?: string[];
          actions?: Record<string, { requires?: string[]; produces?: string[] }>;
        };
        for (const name of def.requires ?? []) entryFor(name).requiredBy.push(step.id);
        for (const name of def.produces ?? []) entryFor(name).producedBy.push(step.id);
        for (const [actionId, action] of Object.entries(def.actions ?? {})) {
          const site = `${step.id}.${actionId}`;
          for (const name of action.requires ?? []) entryFor(name).requiredBy.push(site);
          for (const name of action.produces ?? []) entryFor(name).producedBy.push(site);
        }
      }
      const all = [...flows.values()];
      if (key !== undefined) {
        const found = all.find((flow) => flow.key === key);
        if (!found) {
          throw new ToolError(
            `Unknown context key "${key}" in feature "${entry.id}". ` +
              `Keys: ${all.map((flow) => flow.key).join(", ") || "(none)"}.`,
          );
        }
        return found;
      }
      return all;
    },
  },
];

/**
 * Name, argument summary and description of every MCP tool — the single
 * source the dashboard's MCP page renders, so the table can never drift
 * from the server again.
 */
export function toolSummaries(): Array<{ name: string; args: string; description: string }> {
  return TOOLS.map((tool) => ({
    name: tool.name,
    args: tool.argsSummary,
    description: tool.description,
  }));
}

function toolDescriptors(): McpToolDescriptor[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema, { target: "draft-7" }) as Record<string, unknown>,
  }));
}

// ── Protocol handling ────────────────────────────────────────────────────────

function initializeResult(params: unknown, serverVersion: string) {
  const requested =
    params !== null && typeof params === "object"
      ? (params as Record<string, unknown>).protocolVersion
      : undefined;
  const protocolVersion =
    typeof requested === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "logicspec", version: serverVersion },
    instructions:
      "Tools for querying and validating LogicSpec feature specifications in this workspace. " +
      "Start with list_features, then use get_feature / validate_feature with a feature id.",
  };
}

function callTool(id: JsonRpcId, params: unknown, rootDir: string): JsonRpcResponse {
  if (params === null || typeof params !== "object") {
    return errorResponse(
      id,
      ERROR_CODES.INVALID_PARAMS,
      "tools/call requires params with a tool name.",
    );
  }
  const name = (params as Record<string, unknown>).name;
  if (typeof name !== "string") {
    return errorResponse(
      id,
      ERROR_CODES.INVALID_PARAMS,
      'tools/call params must include a string "name".',
    );
  }
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    return errorResponse(
      id,
      ERROR_CODES.INVALID_PARAMS,
      `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}.`,
    );
  }
  const rawArgs = (params as Record<string, unknown>).arguments ?? {};
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join(".") || "arguments"}: ${issue.message}`)
      .join("; ");
    return errorResponse(
      id,
      ERROR_CODES.INVALID_PARAMS,
      `Invalid arguments for ${name}: ${detail}`,
    );
  }

  // Reload the workspace on every call: files change between calls, and at
  // workspace scale correctness beats caching.
  const workspace = loadWorkspace(rootDir);
  const context: ToolContext = { workspace, rootDir };
  try {
    const result = tool.run(parsed.data, context);
    return successResponse(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    } satisfies McpToolResult);
  } catch (error) {
    const text =
      error instanceof ToolError
        ? error.message
        : `Tool "${name}" failed: ${(error as Error).message}`;
    return successResponse(id, {
      content: [{ type: "text", text }],
      isError: true,
    } satisfies McpToolResult);
  }
}

/**
 * Creates the MCP message handler: one JSON-RPC message in, one response (or
 * undefined for notifications) out. Transport-agnostic — the stdio wiring
 * lives in stdio.ts so tests can drive the handler directly.
 */
export function createMcpHandler(options: McpServerOptions): McpHandler {
  const rootDir = path.resolve(options.rootDir);

  return async (message) => {
    if (message === null || typeof message !== "object" || Array.isArray(message)) {
      return errorResponse(null, ERROR_CODES.INVALID_REQUEST, "Request must be a JSON object.");
    }
    const msg = message as Record<string, unknown>;

    // A response from the peer, not a request: ignore.
    if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) {
      return undefined;
    }

    const hasId = "id" in msg;
    const id = msg.id;
    if (hasId && id !== null && typeof id !== "string" && typeof id !== "number") {
      return errorResponse(
        null,
        ERROR_CODES.INVALID_REQUEST,
        "Request id must be a string, number or null.",
      );
    }
    if (typeof msg.method !== "string") {
      return hasId
        ? errorResponse(
            (id ?? null) as JsonRpcId,
            ERROR_CODES.INVALID_REQUEST,
            'Request is missing a "method".',
          )
        : undefined;
    }

    // Notifications (no id) never get a response — notifications/initialized
    // is acknowledged silently, unknown notifications are ignored.
    if (!hasId) return undefined;

    const requestId = (id ?? null) as JsonRpcId;
    switch (msg.method) {
      case "initialize":
        return successResponse(requestId, initializeResult(msg.params, options.serverVersion));
      case "ping":
        return successResponse(requestId, {});
      case "tools/list":
        return successResponse(requestId, { tools: toolDescriptors() });
      case "tools/call":
        return callTool(requestId, msg.params, rootDir);
      default:
        return errorResponse(
          requestId,
          ERROR_CODES.METHOD_NOT_FOUND,
          `Unknown method "${msg.method}".`,
        );
    }
  };
}
