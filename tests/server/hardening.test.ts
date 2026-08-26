import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

let server: ReturnType<typeof createDashboardServer>;
let port: number;

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw http request so tests can set a spoofed Host header (fetch forbids that). */
function request(
  targetPort: number,
  pathname: string,
  options: { method?: string; host?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: targetPort,
        path: pathname,
        method: options.method ?? "GET",
        ...(options.host !== undefined ? { headers: { Host: options.host } } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  server = createDashboardServer(BOOKING);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("request hardening", () => {
  it("survives malformed percent-encoding in a feature id (404, not a crash)", async () => {
    const res = await request(port, "/api/features/%");
    expect(res.status).toBe(404);
    // The process must still serve the next request — before the guard, the
    // unguarded decodeURIComponent threw and killed the server.
    const after = await request(port, "/api/features");
    expect(after.status).toBe(200);
  });

  it("rejects an unrecognized Host header (DNS-rebinding defense)", async () => {
    const res = await request(port, "/api/features", { host: "evil.example.com" });
    expect(res.status).toBe(403);
  });

  it("accepts loopback Host headers", async () => {
    for (const host of ["localhost:1234", "127.0.0.1:1234", "[::1]:1234"]) {
      const res = await request(port, "/api/features", { host });
      expect(res.status).toBe(200);
    }
  });

  it("accepts an explicitly allowed extra host", async () => {
    const extra = createDashboardServer(BOOKING, { allowedHosts: ["dashboard.internal"] });
    await new Promise<void>((resolve) => extra.listen(0, "127.0.0.1", resolve));
    try {
      const extraPort = (extra.address() as AddressInfo).port;
      const res = await request(extraPort, "/api/features", { host: "dashboard.internal" });
      expect(res.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => extra.close(() => resolve()));
    }
  });

  it("answers /health for GET and HEAD", async () => {
    const get = await request(port, "/health");
    expect(get.status).toBe(200);
    expect(JSON.parse(get.body)).toEqual({ status: "ok" });
    const head = await request(port, "/health", { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  it("answers HEAD on page routes instead of 405", async () => {
    const res = await request(port, "/", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("still rejects mutating methods", async () => {
    const res = await request(port, "/api/features", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("404s a missing asset instead of serving the SPA shell as 200 text/html", async () => {
    const res = await request(port, "/assets/no-such-file.js");
    expect(res.status).toBe(404);
  });

  it("marks API responses no-store", async () => {
    const res = await request(port, "/api/features");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
