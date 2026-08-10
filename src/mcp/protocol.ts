/**
 * Minimal JSON-RPC 2.0 + Model Context Protocol (MCP) wire types.
 *
 * Hand-rolled on purpose: the MCP surface LogicSpec needs (initialize,
 * tools/list, tools/call over stdio) is small and stable, and keeping the
 * package dependency-free matters more than tracking an SDK.
 */

export const JSONRPC_VERSION = "2.0";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Standard JSON-RPC 2.0 error codes used by the server. */
export const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** MCP protocol revisions this server can speak. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
export const LATEST_PROTOCOL_VERSION = "2025-06-18";

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

/** Result payload of a tools/call request. */
export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

export function successResponse(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}
