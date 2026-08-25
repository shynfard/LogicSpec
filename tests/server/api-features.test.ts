import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
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

interface FeatureSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  steps: number;
}

describe("GET /api/features", () => {
  it("lists every feature with validity and step count", async () => {
    const res = await fetch(`${base}/api/features`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as FeatureSummary[];
    const ids = body.map((f) => f.id).sort();
    expect(ids).toEqual(["booking", "notify-booking"]);
    const booking = body.find((f) => f.id === "booking");
    expect(booking?.name).toBe("Booking");
    expect(booking?.valid).toBe(true);
    expect(booking?.steps).toBeGreaterThan(0);
  });

  it("includes correct errorCount, warningCount and path for a fixture feature", async () => {
    const res = await fetch(`${base}/api/features`);
    const body = (await res.json()) as FeatureSummary[];
    const booking = body.find((f) => f.id === "booking");
    expect(booking).toMatchObject({
      path: "booking.feature.yaml",
      errorCount: 0,
      warningCount: 0,
      description: "Customer books and pays for a service.",
    });
  });

  it("is sorted by id, matching create-server.ts's localeCompare sort", async () => {
    const res = await fetch(`${base}/api/features`);
    const body = (await res.json()) as FeatureSummary[];
    const ids = body.map((f) => f.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  it("returns [] for a valid workspace with zero feature files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-empty-workspace-"));
    fs.writeFileSync(path.join(dir, "logicspec.config.yaml"), 'version: "1"\n');
    fs.mkdirSync(path.join(dir, "features"), { recursive: true });

    const emptyServer = createDashboardServer(dir);
    await new Promise<void>((resolve) => emptyServer.listen(0, "127.0.0.1", resolve));
    const address = emptyServer.address() as AddressInfo;
    const emptyBase = `http://127.0.0.1:${address.port}`;

    try {
      const res = await fetch(`${emptyBase}/api/features`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => emptyServer.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
