import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Io } from "../../src/cli/report.js";
import { runServe } from "../../src/cli/serve.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function captureIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

describe("serve command", () => {
  it("starts the dashboard for the booking workspace", async () => {
    const io = captureIo();
    const started = new Promise<Server>((resolve) => {
      const code = runServe(path.join(ROOT, "examples", "booking"), {
        cwd: ROOT,
        io,
        port: 0,
        onListening: resolve,
      });
      expect(code).toBe(0);
    });
    const server = await started;
    try {
      const address = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(res.status).toBe(200);
      expect(io.stdout.join("\n")).toContain("dashboard running");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports a friendly error when the port is taken instead of crashing", async () => {
    const io = captureIo();
    const first = new Promise<Server>((resolve) => {
      runServe(path.join(ROOT, "examples", "booking"), {
        cwd: ROOT,
        io: captureIo(),
        port: 0,
        handleSignals: false,
        onListening: resolve,
      });
    });
    const holder = await first;
    const takenPort = (holder.address() as AddressInfo).port;
    try {
      await new Promise<void>((resolve) => {
        const code = runServe(path.join(ROOT, "examples", "booking"), {
          cwd: ROOT,
          io: {
            out: io.out,
            err: (line) => {
              io.err(line);
              resolve();
            },
          },
          port: takenPort,
          handleSignals: false,
        });
        expect(code).toBe(0);
      });
      expect(io.stderr.join("\n")).toContain("already in use");
    } finally {
      // The error path sets the CLI exit code on the shared process object;
      // reset it so the test runner's own exit status stays green.
      process.exitCode = 0;
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });

  it("warns when binding a non-loopback host", async () => {
    const io = captureIo();
    const started = new Promise<Server>((resolve) => {
      runServe(path.join(ROOT, "examples", "booking"), {
        cwd: ROOT,
        io,
        port: 0,
        host: "0.0.0.0",
        handleSignals: false,
        onListening: resolve,
      });
    });
    const server = await started;
    try {
      expect(io.stderr.join("\n")).toContain("unauthenticated");
      // Wildcard bind prints a navigable loopback URL, not http://0.0.0.0:…
      expect(io.stdout.join("\n")).toContain("http://127.0.0.1:");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("exits 2 without a workspace config", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-serve-nows-"));
    try {
      const io = captureIo();
      expect(runServe(empty, { cwd: empty, io })).toBe(2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
