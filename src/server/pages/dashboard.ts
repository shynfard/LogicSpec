import { countBySeverity } from "../../diagnostics/diagnostic.js";
import type { FeatureRecord } from "../data.js";
import { badge, escapeHtml, layout } from "../html.js";

function card(record: FeatureRecord): string {
  const counts = countBySeverity(record.result.diagnostics);
  const steps = record.result.stats?.steps ?? 0;
  return [
    '<div class="card">',
    `<a href="/features/${encodeURIComponent(record.id)}">${escapeHtml(record.name)}</a> `,
    badge(record.result.valid, counts.error, counts.warning),
    `<div class="muted">${escapeHtml(record.id)} · ${escapeHtml(record.target.display)} · ${steps} step${steps === 1 ? "" : "s"}</div>`,
    "</div>",
  ].join("\n");
}

/** `GET /` — every feature in the workspace, as a clickable card. */
export function renderDashboardPage(records: readonly FeatureRecord[]): string {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const body =
    sorted.length === 0
      ? "<p>No features found in this workspace.</p>"
      : sorted.map(card).join("\n");
  return layout({ title: "LogicSpec Dashboard", body });
}
