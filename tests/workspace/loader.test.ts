import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspace } from "../../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("loadWorkspace", () => {
  it("loads the booking example workspace with catalogs and features", () => {
    const workspace = loadWorkspace(BOOKING);
    expect(workspace.configPath).toBe(path.join(BOOKING, "logicspec.config.yaml"));
    expect(workspace.diagnostics).toEqual([]);
    expect(Object.keys(workspace.services?.services ?? {})).toEqual([
      "booking",
      "payment",
      "notification",
    ]);
    expect(Object.keys(workspace.events?.events ?? {})).toEqual([
      "BookingCreated",
      "PaymentCompleted",
    ]);
    expect(workspace.features.map((f) => f.id)).toEqual(["booking", "notify-booking"]);
    expect(workspace.knownFlows?.has("booking")).toBe(true);
    expect(workspace.knownFlows?.has("notify-booking")).toBe(true);
    expect(workspace.flowOutcomes?.get("notify-booking")).toEqual(new Set(["success", "failure"]));
  });

  it("loads referenced OpenAPI and AsyncAPI documents once each", () => {
    const workspace = loadWorkspace(BOOKING);
    expect(workspace.openApiDocuments.size).toBe(1);
    const openapi = [...workspace.openApiDocuments.values()][0];
    expect(openapi?.operationIds.has("reserveSlot")).toBe(true);
    expect(workspace.asyncApiDocuments.size).toBe(1);
    const asyncapi = [...workspace.asyncApiDocuments.values()][0];
    expect(asyncapi?.channels.has("booking.created")).toBe(true);
  });

  it("collects per-feature dependency info", () => {
    const workspace = loadWorkspace(BOOKING);
    const booking = workspace.features.find((f) => f.id === "booking");
    expect(booking?.publishes).toEqual(["BookingCreated"]);
    expect(booking?.services?.sort()).toEqual(["booking", "payment"]);
    const notify = workspace.features.find((f) => f.id === "notify-booking");
    expect(notify?.waitsFor).toEqual(["BookingCreated"]);
    expect(notify?.services).toEqual(["notification"]);
  });

  it("falls back to defaults without a config file", () => {
    const workspace = loadWorkspace(path.parse(ROOT).root);
    expect(workspace.configPath).toBeUndefined();
    expect(workspace.services).toBeUndefined();
    expect(workspace.knownFlows).toBeUndefined();
    expect(workspace.config.render.view).toBe("flow");
  });
});

describe("loadWorkspace path containment (LS005)", () => {
  const bases: string[] = [];

  afterEach(() => {
    for (const base of bases.splice(0)) {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  /** Creates `base/` with a `ws/` workspace root plus a sibling "outside" area. */
  function makeBase(): { base: string; root: string } {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ls-loader-"));
    bases.push(base);
    const root = path.join(base, "ws");
    fs.mkdirSync(path.join(root, "features"), { recursive: true });
    return { base, root };
  }

  const OUTSIDE_SERVICES = [
    'version: "1"',
    "services:",
    "  leaked:",
    "    operations:",
    "      pull:",
    "        kind: internal",
    "",
  ].join("\n");

  function writeConfig(root: string, body: string): void {
    fs.writeFileSync(path.join(root, "logicspec.config.yaml"), `version: "1"\n${body}\n`, "utf8");
  }

  const ls005 = (d: { code: string }) => d.code === "LS005";

  it("refuses an absolute catalog path that escapes the workspace root", () => {
    const { base, root } = makeBase();
    const secret = path.join(base, "secret-services.yaml");
    fs.writeFileSync(secret, OUTSIDE_SERVICES, "utf8");
    writeConfig(root, `features:\n  directory: ./features\ncatalogs:\n  services: ${secret}`);

    const workspace = loadWorkspace(root);

    // The outside file was NOT read or parsed.
    expect(workspace.services).toBeUndefined();
    // A single LS005 error is reported, located at the config value.
    const unsafe = workspace.diagnostics.filter(ls005);
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.severity).toBe("error");
    expect(unsafe[0]?.name).toBe("UNSAFE_WORKSPACE_PATH");
    expect(unsafe[0]?.file).toBe(path.join(root, "logicspec.config.yaml"));
    expect(unsafe[0]?.path).toEqual(["catalogs", "services"]);
    // No file-read/parse diagnostic for the refused file.
    expect(workspace.diagnostics.some((d) => d.code === "LS004")).toBe(false);
  });

  it("refuses a '..'-escaping catalog path", () => {
    const { base, root } = makeBase();
    fs.writeFileSync(path.join(base, "secret-services.yaml"), OUTSIDE_SERVICES, "utf8");
    writeConfig(
      root,
      "features:\n  directory: ./features\ncatalogs:\n  services: ../secret-services.yaml",
    );

    const workspace = loadWorkspace(root);

    expect(workspace.services).toBeUndefined();
    const unsafe = workspace.diagnostics.filter(ls005);
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.severity).toBe("error");
    expect(unsafe[0]?.path).toEqual(["catalogs", "services"]);
  });

  it("refuses an openapi document: that escapes the workspace root", () => {
    const { base, root } = makeBase();
    // A legitimate, in-root services catalog whose operation points its
    // OpenAPI document outside the root.
    fs.writeFileSync(
      path.join(root, "services.yaml"),
      [
        'version: "1"',
        "services:",
        "  svc:",
        "    operations:",
        "      op:",
        "        kind: http",
        "        method: GET",
        "        path: /x",
        "        openapi:",
        "          document: ../secret-openapi.yaml",
        "          operationId: doThing",
        "",
      ].join("\n"),
      "utf8",
    );
    // The escape target is a valid OpenAPI doc — if it were read, its op would show up.
    fs.writeFileSync(
      path.join(base, "secret-openapi.yaml"),
      ["openapi: 3.0.0", "paths:", "  /x:", "    get:", "      operationId: doThing", ""].join(
        "\n",
      ),
      "utf8",
    );
    writeConfig(root, "features:\n  directory: ./features\ncatalogs:\n  services: ./services.yaml");

    const workspace = loadWorkspace(root);

    // The in-root catalog loaded, but the escaping OpenAPI document did not.
    expect(Object.keys(workspace.services?.services ?? {})).toEqual(["svc"]);
    expect(workspace.openApiDocuments.size).toBe(0);
    const unsafe = workspace.diagnostics.filter(ls005);
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.severity).toBe("error");
    expect(unsafe[0]?.file).toBe(path.join(root, "services.yaml"));
    expect(unsafe[0]?.path).toEqual(["services", "svc", "operations", "op", "openapi", "document"]);
  });

  it("refuses an asyncapi document: that escapes the workspace root", () => {
    const { base, root } = makeBase();
    fs.writeFileSync(
      path.join(root, "events.yaml"),
      [
        'version: "1"',
        "events:",
        "  Thing:",
        "    asyncapi:",
        "      document: ../secret-asyncapi.yaml",
        "      channel: thing.created",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(base, "secret-asyncapi.yaml"),
      ["asyncapi: 3.0.0", "channels:", "  thing.created: {}", ""].join("\n"),
      "utf8",
    );
    writeConfig(root, "features:\n  directory: ./features\ncatalogs:\n  events: ./events.yaml");

    const workspace = loadWorkspace(root);

    expect(Object.keys(workspace.events?.events ?? {})).toEqual(["Thing"]);
    expect(workspace.asyncApiDocuments.size).toBe(0);
    const unsafe = workspace.diagnostics.filter(ls005);
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.severity).toBe("error");
    expect(unsafe[0]?.path).toEqual(["events", "Thing", "asyncapi", "document"]);
  });

  it("refuses a features directory that escapes the workspace root", () => {
    const { root } = makeBase();
    writeConfig(root, "features:\n  directory: ../../etc");

    const workspace = loadWorkspace(root);

    expect(workspace.features).toEqual([]);
    const unsafe = workspace.diagnostics.filter(ls005);
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0]?.path).toEqual(["features", "directory"]);
  });

  it("loads a normal in-root workspace with catalogs and API docs, no LS005", () => {
    const { root } = makeBase();
    fs.writeFileSync(
      path.join(root, "services.yaml"),
      [
        'version: "1"',
        "services:",
        "  svc:",
        "    operations:",
        "      op:",
        "        kind: http",
        "        method: GET",
        "        path: /x",
        "        openapi:",
        "          document: ./openapi.yaml",
        "          operationId: doThing",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "openapi.yaml"),
      ["openapi: 3.0.0", "paths:", "  /x:", "    get:", "      operationId: doThing", ""].join(
        "\n",
      ),
      "utf8",
    );
    writeConfig(root, "features:\n  directory: ./features\ncatalogs:\n  services: ./services.yaml");

    const workspace = loadWorkspace(root);

    expect(workspace.diagnostics.filter(ls005)).toEqual([]);
    expect(Object.keys(workspace.services?.services ?? {})).toEqual(["svc"]);
    expect(workspace.openApiDocuments.size).toBe(1);
    const openapi = [...workspace.openApiDocuments.values()][0];
    expect(openapi?.operationIds.has("doThing")).toBe(true);
  });
});
