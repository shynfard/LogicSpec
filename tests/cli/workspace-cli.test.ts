import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDiff } from "../../src/cli/diff.js";
import { runGraph } from "../../src/cli/graph.js";
import type { Io } from "../../src/cli/report.js";
import { runValidate } from "../../src/cli/validate.js";

function captureIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (l) => stdout.push(l), err: (l) => stderr.push(l) };
}

let dir: string;

const CONFIG = `version: "1"
features:
  directory: ./features
catalogs:
  services: ./services.yaml
output:
  directory: ./generated
diagnostics:
  LS400: "off"
`;

const SERVICES = `version: "1"
services:
  billing:
    operations:
      charge:
        kind: http
        method: POST
        path: /charges
        openapi:
          document: ./openapi.yaml
          operationId: chargeCard
`;

const OPENAPI = `openapi: 3.0.3
info: { title: Billing, version: 1.0.0 }
paths:
  /charges:
    post:
      operationId: createCharge
      responses: { "201": { description: ok } }
`;

const CHECKOUT = `version: "1"
feature: { id: checkout, name: Checkout }
start: pay
steps:
  pay:
    type: operation
    call: billing.charge
    on:
      success: { next: done }
      declined: { next: failed }
  done:
    type: final
    outcome: success
  failed:
    type: final
    outcome: failure
`;

const REFUND = `version: "1"
feature: { id: refund, name: Refund }
start: run-checkout
steps:
  run-checkout:
    type: subflow
    flow: checkout
    on:
      success: { next: done }
      cancelled: { next: done }
  done:
    type: final
    outcome: success
`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-ws-"));
  fs.mkdirSync(path.join(dir, "features"));
  fs.writeFileSync(path.join(dir, "logicspec.config.yaml"), CONFIG);
  fs.writeFileSync(path.join(dir, "services.yaml"), SERVICES);
  fs.writeFileSync(path.join(dir, "openapi.yaml"), OPENAPI);
  fs.writeFileSync(path.join(dir, "features", "checkout.feature.yaml"), CHECKOUT);
  fs.writeFileSync(path.join(dir, "features", "refund.feature.yaml"), REFUND);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("workspace-level validation", () => {
  it("bare validate covers the whole workspace and surfaces catalog findings", () => {
    const io = captureIo();
    const code = runValidate([], { cwd: dir, io });
    const err = io.stderr.join("\n");
    // LS108: chargeCard does not exist in openapi.yaml (createCharge does).
    expect(err).toContain("LS108");
    expect(err).toContain("chargeCard");
    // LS404: checkout never ends in "cancelled".
    const all = `${io.stdout.join("\n")}\n${err}`;
    expect(all).toContain("LS404");
    expect(code).toBe(1);
  });

  it("validate --json emits a stable machine-readable report", () => {
    const io = captureIo();
    const code = runValidate([], { cwd: dir, io, json: true });
    expect(code).toBe(1);
    const report = JSON.parse(io.stdout.join("\n"));
    expect(report.valid).toBe(false);
    expect(report.files).toHaveLength(2);
    expect(report.files.map((f: { file: string }) => path.basename(f.file))).toEqual([
      "checkout.feature.yaml",
      "refund.feature.yaml",
    ]);
    const workspaceCodes = report.workspace.diagnostics.map((d: { code: string }) => d.code);
    expect(workspaceCodes).toContain("LS108");
    expect(report.summary.errors).toBeGreaterThan(0);
    // LS400 is switched off in this workspace's config.
    const allCodes = [
      ...workspaceCodes,
      ...report.files.flatMap((f: { diagnostics: { code: string }[] }) =>
        f.diagnostics.map((d) => d.code),
      ),
    ];
    expect(allCodes).not.toContain("LS400");
  });

  it("bare validate without a workspace config exits 2", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-empty-"));
    try {
      const io = captureIo();
      expect(runValidate([], { cwd: empty, io })).toBe(2);
      expect(io.stderr.join("\n")).toContain("LS003");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("graph command", () => {
  it("writes the workspace dependency graph", () => {
    const io = captureIo();
    const code = runGraph(dir, { cwd: dir, io });
    expect(code).toBe(2); // workspace has an LS108 error → usage/config band
    const out = fs.readFileSync(path.join(dir, "generated", "dependencies.md"), "utf8");
    expect(out).toContain("GENERATED FILE");
    expect(out).toContain("```mermaid");
    expect(out).toContain('-- "subflow" -->');
  });

  it("supports bare mermaid output with services", () => {
    const io = captureIo();
    runGraph(dir, { cwd: dir, io, format: "mermaid", services: true });
    const out = fs.readFileSync(path.join(dir, "generated", "dependencies.mmd"), "utf8");
    expect(out.startsWith("flowchart LR")).toBe(true);
    expect(out).toContain("billing");
  });
});

describe("diff command", () => {
  it("reports semantic changes between two files", () => {
    const before = path.join(dir, "features", "checkout.feature.yaml");
    const after = path.join(dir, "after.feature.yaml");
    fs.writeFileSync(
      after,
      CHECKOUT.replace("declined: { next: failed }", "declined: { next: done }").replace(
        "name: Checkout",
        "name: Checkout v2",
      ),
    );
    const io = captureIo();
    expect(runDiff(before, after, { cwd: dir, io })).toBe(0);
    const out = io.stdout.join("\n");
    expect(out).toContain("failed");

    const jsonIo = captureIo();
    runDiff(before, after, { cwd: dir, io: jsonIo, json: true });
    const diff = JSON.parse(jsonIo.stdout.join("\n"));
    expect(diff.identical).toBe(false);
    expect(diff.removedEdges).toContainEqual(
      expect.objectContaining({ from: "pay", to: "failed" }),
    );
  });

  it("exits 2 when an input does not parse", () => {
    const bad = path.join(dir, "bad.feature.yaml");
    fs.writeFileSync(bad, "version: [nope");
    const io = captureIo();
    expect(runDiff(bad, bad, { cwd: dir, io })).toBe(2);
  });
});
