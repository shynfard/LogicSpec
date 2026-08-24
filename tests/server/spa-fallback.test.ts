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
});
