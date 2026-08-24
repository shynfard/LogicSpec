import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/server/create-server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BOOKING = path.join(ROOT, "examples", "booking");

describe("live reload", () => {
  it("pushes a reload event when a feature file changes", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logicspec-serve-"));
    fs.cpSync(BOOKING, tmp, { recursive: true });
    const server = createDashboardServer(tmp);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${address.port}/events`, {
        signal: controller.signal,
      });
      const reader = res.body?.getReader();
      if (reader === undefined) throw new Error("expected a streaming response body");

      const received = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("timed out waiting for SSE reload")),
          4000,
        );
        const decoder = new TextDecoder();
        let buffer = "";
        const pump = (): void => {
          reader
            .read()
            .then(({ value, done }) => {
              if (done) return;
              buffer += decoder.decode(value);
              if (buffer.includes("data: reload")) {
                clearTimeout(timeout);
                resolve(buffer);
                return;
              }
              pump();
            })
            .catch(reject);
        };
        pump();
      });

      // Give the watcher a moment to finish its initial scan before touching the file.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const featureFile = path.join(tmp, "booking.feature.yaml");
      fs.writeFileSync(featureFile, `${fs.readFileSync(featureFile, "utf8")}\n`);

      await expect(received).resolves.toContain("data: reload");
      controller.abort();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 8000);
});
