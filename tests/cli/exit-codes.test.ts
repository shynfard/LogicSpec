import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { runInspect } from "../../src/cli/inspect.js";
import { runRender } from "../../src/cli/render.js";
import type { Io } from "../../src/cli/report.js";
import { runValidate } from "../../src/cli/validate.js";
import { MINIMAL_FEATURE } from "../helpers.js";

function captureIo(): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  };
}

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-cli-"));
  fs.writeFileSync(path.join(dir, "valid.feature.yaml"), MINIMAL_FEATURE);
  fs.writeFileSync(
    path.join(dir, "invalid.feature.yaml"),
    MINIMAL_FEATURE.replace("next: done", "next: something-that-does-not-exist"),
  );
  fs.writeFileSync(path.join(dir, "broken.feature.yaml"), "version: [unclosed");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("CLI exit codes", () => {
  it("validate returns 0 for a valid file", () => {
    const io = captureIo();
    expect(runValidate([path.join(dir, "valid.feature.yaml")], { cwd: dir, io })).toBe(0);
    expect(io.stdout.join("\n")).toContain("is valid");
  });

  it("validate returns 1 for validation errors and names the unknown step", () => {
    const io = captureIo();
    expect(runValidate([path.join(dir, "invalid.feature.yaml")], { cwd: dir, io })).toBe(1);
    expect(io.stderr.join("\n")).toContain("something-that-does-not-exist");
  });

  it("validate returns 2 for unparseable YAML", () => {
    const io = captureIo();
    expect(runValidate([path.join(dir, "broken.feature.yaml")], { cwd: dir, io })).toBe(2);
  });

  it("validate returns 2 for a missing file", () => {
    const io = captureIo();
    expect(runValidate([path.join(dir, "nope.feature.yaml")], { cwd: dir, io })).toBe(2);
  });

  it("validate handles directories", () => {
    const io = captureIo();
    // Directory contains valid, invalid and broken files → worst wins (2).
    expect(runValidate([dir], { cwd: dir, io })).toBe(2);
  });

  it("render writes output for valid specs and refuses invalid ones", () => {
    const io = captureIo();
    const out = path.join(dir, "generated");
    expect(runRender([path.join(dir, "valid.feature.yaml")], { cwd: dir, io, output: out })).toBe(
      0,
    );
    const rendered = fs.readFileSync(path.join(out, "valid.md"), "utf8");
    expect(rendered).toContain("```mermaid");

    const io2 = captureIo();
    expect(
      runRender([path.join(dir, "invalid.feature.yaml")], { cwd: dir, io: io2, output: out }),
    ).toBe(1);
    expect(fs.existsSync(path.join(out, "invalid.md"))).toBe(false);
    expect(io2.stderr.join("\n")).toContain("nothing rendered");
  });

  it("render --format mermaid writes a bare .mmd file", () => {
    const io = captureIo();
    const out = path.join(dir, "mmd-out");
    expect(
      runRender([path.join(dir, "valid.feature.yaml")], {
        cwd: dir,
        io,
        output: out,
        format: "mermaid",
      }),
    ).toBe(0);
    const rendered = fs.readFileSync(path.join(out, "valid.mmd"), "utf8");
    expect(rendered.startsWith("flowchart TD")).toBe(true);
  });

  it("inspect --json emits stable machine-readable output", () => {
    const io = captureIo();
    expect(runInspect([path.join(dir, "valid.feature.yaml")], { cwd: dir, io, json: true })).toBe(
      0,
    );
    const report = JSON.parse(io.stdout.join("\n"));
    expect(report.feature).toBe("demo");
    expect(report.start).toBe("home");
    expect(report.terminals).toEqual(["done"]);
    expect(report.edges).toEqual([{ from: "home", to: "done", kind: "action", label: "go" }]);
  });

  it("validate returns 1 (not a crash/2) for a runaway-deep $ref chain", () => {
    // A LINEAR, non-cyclic definition chain thousands deep must degrade to a
    // graceful LS112 (validation error, exit 1), never an uncaught stack
    // overflow that would crash the CLI (exit 2).
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-deepref-"));
    try {
      const depth = 10_000;
      const chain = ['version: "1"', "steps:"];
      for (let i = 0; i < depth; i++) {
        chain.push(`  s${i}:`, `    $ref: "definitions#/steps/s${i + 1}"`);
      }
      chain.push(`  s${depth}:`, "    type: operation", "    label: End");
      fs.writeFileSync(path.join(wsDir, "definitions.yaml"), `${chain.join("\n")}\n`);
      fs.writeFileSync(
        path.join(wsDir, "logicspec.config.yaml"),
        'version: "1"\nfeatures:\n  directory: .\ncatalogs:\n  definitions: ./definitions.yaml\n',
      );
      fs.writeFileSync(
        path.join(wsDir, "deep.feature.yaml"),
        `version: "1"
feature:
  id: deep
  name: Deep
start: home
actors:
  web:
    kind: frontend
steps:
  home:
    type: page
    actor: web
    actions:
      go:
        next: deep
  deep:
    $ref: "definitions#/steps/s0"
    next: done
  done:
    type: final
    outcome: success
`,
      );
      const io = captureIo();
      let exit = -1;
      expect(() => {
        exit = runValidate([path.join(wsDir, "deep.feature.yaml")], { cwd: wsDir, io });
      }).not.toThrow();
      expect(exit).toBe(1);
      expect([...io.stdout, ...io.stderr].join("\n")).toContain("LS112");
    } finally {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
    // 10k-entry catalog stress case: generous timeout over the 5s default so it
    // doesn't flake under parallel CPU load (the fix itself returns fast).
  }, 30000);

  it("init scaffolds a valid workspace and never overwrites", () => {
    const initDir = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-init-"));
    try {
      const io = captureIo();
      expect(runInit({ cwd: initDir, io })).toBe(0);
      expect(fs.existsSync(path.join(initDir, "logicspec.config.yaml"))).toBe(true);

      // The scaffolded example must validate cleanly against its own workspace.
      const io2 = captureIo();
      expect(
        runValidate([path.join(initDir, "features", "signup.feature.yaml")], {
          cwd: initDir,
          io: io2,
        }),
      ).toBe(0);

      // Second init must not clobber anything.
      const marker = "# user edit\n";
      fs.appendFileSync(path.join(initDir, "services.yaml"), marker);
      const io3 = captureIo();
      expect(runInit({ cwd: initDir, io: io3 })).toBe(0);
      expect(fs.readFileSync(path.join(initDir, "services.yaml"), "utf8")).toContain(marker);
    } finally {
      fs.rmSync(initDir, { recursive: true, force: true });
    }
  });
});
