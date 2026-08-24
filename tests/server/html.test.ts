import { describe, expect, it } from "vitest";
import { badge, escapeHtml, layout } from "../../src/server/html.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)> & "quoted" 'single'`)).toBe(
      "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &#39;single&#39;",
    );
  });
});

describe("badge", () => {
  it("shows an error count when invalid", () => {
    expect(badge(false, 2, 0)).toContain("2 errors");
  });
  it("shows a warning count when valid with warnings", () => {
    expect(badge(true, 0, 1)).toContain("1 warning");
  });
  it("shows valid with no diagnostics", () => {
    expect(badge(true, 0, 0)).toContain("valid");
  });
});

describe("layout", () => {
  it("escapes the title, embeds the body and script verbatim, and wires live reload", () => {
    const html = layout({ title: "<x>", body: "<p>hi</p>", script: "console.log(1)" });
    expect(html).toContain("<title>&lt;x&gt;</title>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("console.log(1)");
    expect(html).toContain("EventSource");
  });
});
