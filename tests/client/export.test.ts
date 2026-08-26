import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadText,
  exportMermaidView,
  pageBackground,
  serializeSvg,
} from "../../client/src/lib/export";

function interceptDownloads(): Array<{ download: string; href: string }> {
  const captured: Array<{ download: string; href: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    captured.push({ download: this.download, href: this.href });
  });
  // jsdom has no URL.createObjectURL by default.
  if (typeof URL.createObjectURL !== "function") {
    Object.assign(URL, {
      createObjectURL: () => "blob:mock",
      revokeObjectURL: () => {},
    });
  }
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadText", () => {
  it("triggers a download with the requested filename", () => {
    const captured = interceptDownloads();
    downloadText("booking-flow.mmd", "flowchart TD", "text/vnd.mermaid");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.download).toBe("booking-flow.mmd");
  });
});

describe("serializeSvg", () => {
  it("produces a standalone SVG document with concrete dimensions", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 640 480");
    svg.style.maxWidth = "100%";
    const out = serializeSvg(svg as SVGSVGElement);
    expect(out).toContain('<?xml version="1.0"');
    expect(out).toContain('width="640"');
    expect(out).toContain('height="480"');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe("exportMermaidView", () => {
  it("downloads the Mermaid source as .mmd", async () => {
    const captured = interceptDownloads();
    await exportMermaidView("booking-flow", "mmd", "flowchart TD\n  a --> b", null);
    expect(captured[0]?.download).toBe("booking-flow.mmd");
  });

  it("downloads the rendered SVG as .svg", async () => {
    const captured = interceptDownloads();
    const container = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    container.appendChild(svg);
    await exportMermaidView("booking-sequence", "svg", "sequenceDiagram", container);
    expect(captured[0]?.download).toBe("booking-sequence.svg");
  });

  it("rejects when asked for SVG with nothing rendered", async () => {
    interceptDownloads();
    await expect(exportMermaidView("x", "svg", "flowchart TD", null)).rejects.toThrow(
      "No rendered diagram",
    );
  });
});

describe("pageBackground", () => {
  it("falls back to white when the body is transparent", () => {
    expect(pageBackground()).toBe("#ffffff");
  });
});
