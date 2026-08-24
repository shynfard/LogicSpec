/** Escapes text for safe interpolation into HTML content and attributes. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Validation summary badge for a dashboard card or a detail page header. */
export function badge(valid: boolean, errorCount: number, warningCount: number): string {
  if (!valid) {
    return `<span class="badge badge-error">${errorCount} error${errorCount === 1 ? "" : "s"}</span>`;
  }
  if (warningCount > 0) {
    return `<span class="badge badge-warn">${warningCount} warning${warningCount === 1 ? "" : "s"}</span>`;
  }
  return '<span class="badge badge-ok">valid</span>';
}

export interface LayoutOptions {
  title: string;
  body: string;
  /** Extra <head> content, e.g. a <script src> for a specific page. */
  head?: string;
  /** Extra inline <script> content, appended after the live-reload client. */
  script?: string;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 0; }
  header { padding: 12px 20px; border-bottom: 1px solid #8884; display: flex; gap: 16px; align-items: center; }
  header a { text-decoration: none; font-weight: 600; }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
  .badge-ok { background: #1a7f3722; color: #1a7f37; }
  .badge-warn { background: #9a670322; color: #9a6703; }
  .badge-error { background: #cf222e22; color: #cf222e; }
  .card { border: 1px solid #8884; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; }
  .card a { text-decoration: none; font-size: 16px; font-weight: 600; }
  .muted { opacity: 0.65; font-size: 12px; }
  nav.tabs { display: flex; gap: 4px; border-bottom: 1px solid #8884; margin-bottom: 16px; }
  nav.tabs button { border: none; background: none; padding: 8px 14px; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
  nav.tabs button.active { border-bottom-color: currentColor; font-weight: 600; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  pre { background: #8881; padding: 12px; border-radius: 6px; overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #8882; font-size: 13px; }
  tr.highlight { outline: 2px solid currentColor; }
  .diagnostic { border-left: 3px solid #8884; padding: 6px 10px; margin-bottom: 6px; }
  .diagnostic.error { border-left-color: #cf222e; }
  .diagnostic.warning { border-left-color: #9a6703; }
  #diagram-container .node { cursor: pointer; }
`;

const LIVE_RELOAD_SCRIPT = `
  try {
    var es = new EventSource("/events");
    es.onmessage = function () { location.reload(); };
  } catch (e) {}
`;

/** Shared page chrome: nav, styling, and the live-reload SSE client. */
export function layout(options: LayoutOptions): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${STYLE}</style>`,
    options.head ?? "",
    "</head>",
    "<body>",
    '<header><a href="/">LogicSpec Dashboard</a></header>',
    `<main>${options.body}</main>`,
    `<script>${LIVE_RELOAD_SCRIPT}</script>`,
    options.script !== undefined ? `<script>${options.script}</script>` : "",
    "</body>",
    "</html>",
  ].join("\n");
}
