import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runExport } from "../../src/cli/export.js";
import type { Io } from "../../src/cli/report.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function captureIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

let outDir: string;

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-export-"));
});

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("export command", () => {
  it("builds the full artifact set for the booking workspace", () => {
    const io = captureIo();
    const code = runExport(path.join(ROOT, "examples", "booking"), {
      cwd: ROOT,
      io,
      output: outDir,
    });
    expect(code).toBe(0);

    const files = fs.readdirSync(outDir).sort();
    expect(files).toEqual([
      "booking.json",
      "booking.md",
      "dependencies.md",
      "diagnostics.json",
      "notify-booking.json",
      "notify-booking.md",
      "workspace.json",
    ]);

    const workspace = JSON.parse(fs.readFileSync(path.join(outDir, "workspace.json"), "utf8"));
    expect(workspace.features.map((f: { id: string }) => f.id)).toEqual([
      "booking",
      "notify-booking",
    ]);
    expect(workspace.features.every((f: { valid: boolean }) => f.valid)).toBe(true);
    expect(workspace.services).toEqual(["booking", "payment", "notification"]);

    const model = JSON.parse(fs.readFileSync(path.join(outDir, "booking.json"), "utf8"));
    expect(model.feature).toBe("booking");
    expect(model.stats.transitions).toBe(28);

    expect(fs.readFileSync(path.join(outDir, "booking.md"), "utf8")).toContain("```mermaid");
    expect(fs.readFileSync(path.join(outDir, "dependencies.md"), "utf8")).toContain(
      "BookingCreated",
    );

    const diagnostics = JSON.parse(fs.readFileSync(path.join(outDir, "diagnostics.json"), "utf8"));
    expect(Array.isArray(diagnostics.files)).toBe(true);
  });

  it("exits 2 without a workspace config", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-nows-"));
    try {
      const io = captureIo();
      expect(runExport(empty, { cwd: empty, io })).toBe(2);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
