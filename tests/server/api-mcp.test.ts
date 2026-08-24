import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let base: string;

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/mcp", () => {
  it("returns the registration command and tool list", async () => {
    const res = await fetch(`${base}/api/mcp`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { command: string; tools: unknown[] };
    expect(body.command).toContain("logicspec mcp");
    expect(body.command).toContain(BOOKING);
    expect(body.tools).toHaveLength(7);
  });
});
