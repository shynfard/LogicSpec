import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Loads the REAL built bundle (dist/extension.cjs) with a stubbed `vscode`
 * module and activates it. This is the test that catches load-time crashes
 * the type checker cannot see — e.g. `createRequire(import.meta.url)`
 * becoming `createRequire(undefined)` when esbuild lowers ESM to CJS,
 * which once broke every command with "command not found".
 *
 * Runs after `npm run build` (CI order guarantees this); skips locally
 * when dist/ has not been built yet.
 */

const bundlePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/extension.cjs",
);

const disposable = { dispose() {} };
const passthrough: unknown = new Proxy(function () {}, {
  get: () => passthrough,
  apply: () => passthrough,
  construct: () => ({}),
});

function makeVscodeStub(registered: string[]): Record<string, unknown> {
  return new Proxy(
    {
      languages: {
        createDiagnosticCollection: () => ({
          set() {},
          delete() {},
          clear() {},
          dispose() {},
        }),
      },
      workspace: {
        textDocuments: [],
        workspaceFolders: undefined,
        onDidOpenTextDocument: () => disposable,
        onDidChangeTextDocument: () => disposable,
        onDidSaveTextDocument: () => disposable,
        onDidCloseTextDocument: () => disposable,
        onDidChangeConfiguration: () => disposable,
        openTextDocument: async () => ({}),
        getConfiguration: () => ({ get: () => undefined }),
      },
      window: {
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: () => disposable,
        showWarningMessage: () => undefined,
        showInformationMessage: () => undefined,
      },
      commands: {
        registerCommand: (id: string) => {
          registered.push(id);
          return disposable;
        },
      },
      Uri: class Uri {
        static file(p: string) {
          return { fsPath: p };
        }
        static joinPath() {
          return {};
        }
      },
      Range: class Range {},
      Position: class Position {},
      Diagnostic: class Diagnostic {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ViewColumn: { Beside: 2 },
      EventEmitter: class EventEmitter {
        get event() {
          return () => disposable;
        }
        fire() {}
        dispose() {}
      },
    },
    { get: (target, key) => (key in target ? Reflect.get(target, key) : passthrough) },
  ) as Record<string, unknown>;
}

describe.skipIf(!fs.existsSync(bundlePath))("built extension bundle", () => {
  it("loads and registers its commands under a stubbed vscode host", async () => {
    const registered: string[] = [];
    const stub = makeVscodeStub(registered);

    const moduleAny = Module as unknown as {
      _load: (id: string, ...rest: unknown[]) => unknown;
    };
    const originalLoad = moduleAny._load;
    moduleAny._load = (id: string, ...rest: unknown[]) =>
      id === "vscode" ? stub : originalLoad.call(Module, id, ...rest);

    try {
      const require = Module.createRequire(import.meta.url);
      delete require.cache[bundlePath];
      const extension = require(bundlePath) as {
        activate: (context: unknown) => unknown;
      };
      expect(typeof extension.activate).toBe("function");

      await extension.activate({ subscriptions: [], extensionUri: {} });
      expect(registered).toContain("logicspec.previewFeature");
      expect(registered).toContain("logicspec.validateWorkspace");
    } finally {
      moduleAny._load = originalLoad;
    }
  });
});
