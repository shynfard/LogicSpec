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

  it("includes the feature-level description", async () => {
    const res = await fetch(`${base}/api/features/booking`);
    const body = (await res.json()) as { description?: string };
    expect(body.description).toBe("Customer books and pays for a service.");
  });

  it("404s for an unknown feature id", async () => {
    const res = await fetch(`${base}/api/features/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/features/:id step description/notes/tags", () => {
  let dir: string;
  let taggedServer: ReturnType<typeof createDashboardServer>;
  let taggedBase: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-tagged-step-"));
    fs.mkdirSync(path.join(dir, "features"), { recursive: true });
    fs.writeFileSync(path.join(dir, "logicspec.config.yaml"), 'version: "1"\n');
    fs.writeFileSync(
      path.join(dir, "features", "demo.feature.yaml"),
      MINIMAL_FEATURE.replace(
        "label: Home\n    actor: web",
        "label: Home\n    actor: web\n    description: A demo step.\n    notes: A demo note.\n    tags: [demo, test]",
      ),
    );

    taggedServer = createDashboardServer(dir);
    await new Promise<void>((resolve) => taggedServer.listen(0, "127.0.0.1", resolve));
    const address = taggedServer.address() as AddressInfo;
    taggedBase = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => taggedServer.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("surfaces a step's description, notes and tags", async () => {
    const res = await fetch(`${taggedBase}/api/features/demo`);
    const body = (await res.json()) as {
      diagram?: {
        steps: Array<{ id: string; description?: string; notes?: string; tags?: string[] }>;
      };
    };
    const home = body.diagram?.steps.find((s) => s.id === "home");
    expect(home).toMatchObject({
      description: "A demo step.",
      notes: "A demo note.",
      tags: ["demo", "test"],
    });
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
