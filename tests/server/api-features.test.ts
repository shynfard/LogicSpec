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

describe("GET /api/features", () => {
  it("lists every feature with validity and step count", async () => {
    const res = await fetch(`${base}/api/features`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Array<{
      id: string;
      name: string;
      valid: boolean;
      steps: number;
    }>;
    const ids = body.map((f) => f.id).sort();
    expect(ids).toEqual(["booking", "notify-booking"]);
    const booking = body.find((f) => f.id === "booking");
    expect(booking?.name).toBe("Booking");
    expect(booking?.valid).toBe(true);
    expect(booking?.steps).toBeGreaterThan(0);
  });
});
