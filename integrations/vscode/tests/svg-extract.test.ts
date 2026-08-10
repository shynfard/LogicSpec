// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, expect, it } from "vitest";

/**
 * Mermaid's default flowchart output wraps labels in <foreignObject> whose
 * body is HTML-serialized — unclosed <br>, HTML entities — which is NOT
 * well-formed XML. Parsing it as image/svg+xml therefore yields a
 * parsererror document, which once surfaced to users as
 * "Renderer returned unexpected content." in the preview panel.
 *
 * The fix (mirrored in media/preview.js and the Obsidian plugin): parse as
 * text/html and extract the svg element. This test pins both halves.
 */

const MERMAID_LIKE_SVG = `<svg id="x" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <g class="node">
    <foreignObject width="80" height="40">
      <div xmlns="http://www.w3.org/1999/xhtml">Select Service<br>PAGE&nbsp;</div>
    </foreignObject>
  </g>
</svg>`;

describe("mermaid svg extraction", () => {
  it("strict XML parsing rejects mermaid's HTML-label output (the old bug)", () => {
    const parsed = new DOMParser().parseFromString(MERMAID_LIKE_SVG, "image/svg+xml");
    expect(parsed.documentElement.nodeName.toLowerCase()).not.toBe("svg");
  });

  it("HTML parsing extracts the svg element (the fix)", () => {
    const parsed = new DOMParser().parseFromString(MERMAID_LIKE_SVG, "text/html");
    const root = parsed.body.querySelector("svg");
    expect(root).not.toBeNull();
    expect(root?.querySelector("foreignObject div")?.textContent).toContain("Select Service");
  });
});
