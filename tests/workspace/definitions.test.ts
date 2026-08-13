import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildGraph,
  hasErrors,
  loadWorkspace,
  normalizeFeature,
  renderMermaid,
  validateFeature,
} from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHARED = path.join(ROOT, "examples", "shared");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("shared-definitions example workspace", () => {
  it("loads the definitions catalog", () => {
    const workspace = loadWorkspace(SHARED);
    expect(workspace.configPath).toBe(path.join(SHARED, "logicspec.config.yaml"));
    expect(workspace.diagnostics).toEqual([]);
    expect(Object.keys(workspace.definitions?.actors ?? {})).toEqual(["notifier"]);
    expect(Object.keys(workspace.definitions?.steps ?? {})).toEqual(["send-notification"]);
    expect(workspace.catalogPaths.definitions).toBe(path.join(SHARED, "definitions.yaml"));
  });

  it("validates the $ref-using feature against the workspace", () => {
    const workspace = loadWorkspace(SHARED);
    const source = fs.readFileSync(path.join(SHARED, "reminder.feature.yaml"), "utf8");
    const result = validateFeature(source, {
      file: "reminder.feature.yaml",
      services: workspace.services,
      events: workspace.events,
      definitions: workspace.definitions,
      knownFlows: workspace.knownFlows,
      flowOutcomes: workspace.flowOutcomes,
      severityOverrides: workspace.config.diagnostics,
    });
    expect(hasErrors(result.diagnostics)).toBe(false);
    expect(result.valid).toBe(true);
    // The shared actor and shared step template resolved into the model.
    expect(result.normalized?.actors.map((a) => a.id)).toContain("notifier");
    // The actor $ref carried a local `label` override; local wins (fix 4).
    expect(result.feature?.actors?.notifier?.label).toBe("Reminder Notifier");
    const notify = result.normalized?.steps.find((s) => s.id === "notify");
    expect(notify?.type).toBe("operation");
    expect(notify?.label).toBe("Send Reminder");
  });

  it("renders the expanded feature", () => {
    const workspace = loadWorkspace(SHARED);
    const source = fs.readFileSync(path.join(SHARED, "reminder.feature.yaml"), "utf8");
    const result = validateFeature(source, { definitions: workspace.definitions });
    const normalized = normalizeFeature(result.feature ?? ({} as never));
    const mermaid = renderMermaid(normalized, buildGraph(normalized), {
      view: "flow",
      direction: "TD",
    });
    expect(mermaid).toContain("Send Reminder");
    expect(mermaid).not.toContain("$ref");
  });

  it("keeps the booking example valid", () => {
    const workspace = loadWorkspace(BOOKING);
    expect(hasErrors(workspace.diagnostics)).toBe(false);
    for (const ref of workspace.features) {
      const source = fs.readFileSync(ref.path, "utf8");
      const result = validateFeature(source, {
        services: workspace.services,
        events: workspace.events,
        definitions: workspace.definitions,
        knownFlows: workspace.knownFlows,
        flowOutcomes: workspace.flowOutcomes,
        severityOverrides: workspace.config.diagnostics,
      });
      expect(result.valid, ref.path).toBe(true);
    }
  });
});

describe("definitions catalog path containment (LS005)", () => {
  const bases: string[] = [];

  afterEach(() => {
    for (const base of bases.splice(0)) {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a definitions catalog that escapes the workspace root", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ls-defs-"));
    bases.push(base);
    const root = path.join(base, "ws");
    fs.mkdirSync(path.join(root, "features"), { recursive: true });
    fs.writeFileSync(
      path.join(base, "secret-definitions.yaml"),
      'version: "1"\nactors:\n  leaked:\n    kind: service\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "logicspec.config.yaml"),
      'version: "1"\nfeatures:\n  directory: ./features\ncatalogs:\n  definitions: ../secret-definitions.yaml\n',
      "utf8",
    );

    const workspace = loadWorkspace(root);

    expect(workspace.definitions).toBeUndefined();
    const unsafe = workspace.diagnostics.filter((d) => d.code === "LS005");
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.name).toBe("UNSAFE_WORKSPACE_PATH");
    expect(unsafe[0]?.path).toEqual(["catalogs", "definitions"]);
    // The refused file was never read/parsed.
    expect(workspace.diagnostics.some((d) => d.code === "LS004")).toBe(false);
  });
});
