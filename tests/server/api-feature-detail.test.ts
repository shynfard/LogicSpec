import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";
import { MINIMAL_FEATURE } from "../helpers.js";

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

describe("GET /api/features/:id", () => {
  it("returns the full detail payload for a valid feature", async () => {
    const res = await fetch(`${base}/api/features/booking`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      source: string;
      diagram?: {
        steps: unknown[];
        mermaid: Record<string, string>;
        clickMap: Record<string, unknown>;
      };
      inspect?: { feature: string };
      related: { events: Array<{ event: string; feature: { id: string } }> };
    };
    expect(body.id).toBe("booking");
    expect(body.source).toContain("feature:");
    expect(body.diagram?.steps.length).toBeGreaterThan(0);
    expect(body.diagram?.mermaid.flow).toContain("flowchart");
    expect(body.inspect?.feature).toBe("booking");
    expect(body.related.events).toContainEqual(
      expect.objectContaining({
        event: "BookingCreated",
        feature: { id: "notify-booking", name: "Booking Notification", known: true },
      }),
    );
  });

  it("404s for an unknown feature id", async () => {
    const res = await fetch(`${base}/api/features/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/features/:id for an invalid feature", () => {
  // Covers serializeFeatureDetail's early-return branch (create-server.ts):
  // when record.result.valid is false, the response omits diagram/inspect
  // entirely instead of trying to render/inspect a spec the graph/renderer
  // layers were never meant to see.
  let dir: string;
  let invalidServer: ReturnType<typeof createDashboardServer>;
  let invalidBase: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-invalid-feature-"));
    fs.mkdirSync(path.join(dir, "features"), { recursive: true });
    fs.writeFileSync(path.join(dir, "logicspec.config.yaml"), 'version: "1"\n');
    fs.writeFileSync(
      path.join(dir, "features", "invalid.feature.yaml"),
      MINIMAL_FEATURE.replace("next: done", "next: something-that-does-not-exist"),
    );

    invalidServer = createDashboardServer(dir);
    await new Promise<void>((resolve) => invalidServer.listen(0, "127.0.0.1", resolve));
    const address = invalidServer.address() as AddressInfo;
    invalidBase = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => invalidServer.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("omits diagram/inspect and reports valid: false", async () => {
    const res = await fetch(`${invalidBase}/api/features/demo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
    expect("diagram" in body).toBe(false);
    expect("inspect" in body).toBe(false);
  });
});
