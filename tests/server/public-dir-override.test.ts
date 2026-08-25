import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

// Proves the `publicDir` override (needed by the VS Code extension — see
// src/server/create-server.ts's defaultClientDir() comment for why relative-path
// introspection can't find the built SPA once esbuild bundles the extension
// into one CJS module) actually redirects both "/" and asset-fallback index.html
// serving away from the default dist/server/public toward a caller-supplied
// directory.
describe("publicDir override", () => {
  let overrideDir: string;
  let server: ReturnType<typeof createDashboardServer>;
  let base: string;

  beforeEach(async () => {
    overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-public-dir-"));
    fs.writeFileSync(
      path.join(overrideDir, "index.html"),
      "<!doctype html><html><body>override fixture content</body></html>",
    );

    server = createDashboardServer(BOOKING, { publicDir: overrideDir });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(overrideDir, { recursive: true, force: true });
  });

  it("serves index.html for '/' from the overridden publicDir, not the default", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("override fixture content");
    expect(body).not.toContain('<div id="root">');
  });

  it("serves index.html for a client-side route from the overridden publicDir too", async () => {
    const res = await fetch(`${base}/features/booking`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("override fixture content");
  });

  it("serves /assets/* from the overridden publicDir when the asset exists there", async () => {
    fs.mkdirSync(path.join(overrideDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(overrideDir, "assets", "app.js"),
      "console.log('override fixture asset');",
    );

    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("override fixture asset");
  });
});
