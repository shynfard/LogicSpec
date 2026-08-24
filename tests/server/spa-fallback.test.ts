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

describe("SPA fallback", () => {
  it("serves the built index.html for the root path", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="root">');
  });

  it("serves index.html for a client-side route too", async () => {
    const res = await fetch(`${base}/features/booking`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  it("serves the built JS bundle", async () => {
    const indexRes = await fetch(`${base}/`);
    const html = await indexRes.text();
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(html);
    expect(scriptMatch).not.toBeNull();
    const scriptPath = scriptMatch?.[1] as string;
    const res = await fetch(`${base}${scriptPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("serves /assets/* correctly even when workspaceDir has no logicspec.config.yaml", async () => {
    // The built client is served from a fixed location (dist/server/public),
    // not from workspaceDir — so /assets/* must work independent of whether
    // the requested workspace has a config at all. This matters in
    // practice: integrations/vscode's startDashboard() calls
    // createDashboardServer() directly with no upfront workspace check
    // (unlike the CLI, which gates via requireWorkspace first), so a user
    // running "Start Dashboard" from a non-LogicSpec folder must still get
    // a working SPA shell instead of a blank page whose script 500s.
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(await (await fetch(`${base}/`)).text());
    const scriptPath = scriptMatch?.[1] as string;

    const noConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-no-config-"));
    const noConfigServer = createDashboardServer(noConfigDir);
    await new Promise<void>((resolve) => noConfigServer.listen(0, "127.0.0.1", resolve));
    const address = noConfigServer.address() as AddressInfo;
    const noConfigBase = `http://127.0.0.1:${address.port}`;

    try {
      // Sanity-check the fixture is genuinely config-less: a path that
      // isn't special-cased before the workspace gate should still 500,
      // proving this server instance really does hit the "no workspace"
      // branch and that the /assets/* request below isn't passing only
      // because there happens to be a config after all.
      const nonAssetRes = await fetch(`${noConfigBase}/api/features`);
      expect(nonAssetRes.status).toBe(500);

      const assetRes = await fetch(`${noConfigBase}${scriptPath}`);
      expect(assetRes.status).toBe(200);
      expect(assetRes.headers.get("content-type")).toContain("javascript");
    } finally {
      await new Promise<void>((resolve) => noConfigServer.close(() => resolve()));
      fs.rmSync(noConfigDir, { recursive: true, force: true });
    }
  });
});
