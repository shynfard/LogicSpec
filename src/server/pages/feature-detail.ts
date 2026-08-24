import { countBySeverity } from "../../diagnostics/diagnostic.js";
import { inspectFeature } from "../../inspect.js";
import { renderMermaid } from "../../renderers/markdown.js";
import type { RenderView } from "../../schema/config.js";
import type { FeatureRecord } from "../data.js";
import { badge, escapeHtml, layout } from "../html.js";
import type { RelatedFeatureRef, RelatedFeatures } from "../related.js";

const DIAGRAM_VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];

function diagramTab(record: FeatureRecord): string {
  const { normalized, graph } = record.result;
  if (!record.result.valid || normalized === undefined || graph === undefined) {
    return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  }
  const blocks = DIAGRAM_VIEWS.map((view) => {
    let mermaid: string;
    try {
      mermaid = renderMermaid(normalized, graph, { view });
    } catch {
      return "";
    }
    const hidden = view === "flow" ? "" : " hidden";
    return `<div data-diagram-view="${view}"${hidden}><pre class="mermaid">${escapeHtml(mermaid)}</pre></div>`;
  }).join("\n");
  const options = DIAGRAM_VIEWS.map((v) => `<option value="${v}">${v}</option>`).join("");
  return [
    `<label>View <select id="diagram-view-select">${options}</select></label>`,
    '<div id="diagram-container">',
    blocks,
    "</div>",
  ].join("\n");
}

function stepsTab(record: FeatureRecord): string {
  const normalized = record.result.normalized;
  if (normalized === undefined) return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  const rows = normalized.steps
    .map(
      (step) =>
        `<tr id="step-${escapeHtml(step.id)}"><td>${escapeHtml(step.id)}</td><td>${escapeHtml(step.type)}</td><td>${escapeHtml(step.label)}</td><td>${escapeHtml(step.actor ?? "")}</td></tr>`,
    )
    .join("\n");
  return `<table><thead><tr><th>id</th><th>type</th><th>label</th><th>actor</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function sourceTab(record: FeatureRecord): string {
  return `<pre>${escapeHtml(record.source)}</pre>`;
}

function inspectTab(record: FeatureRecord): string {
  const { normalized, graph } = record.result;
  if (normalized === undefined || graph === undefined) {
    return "<p>Spec is invalid — see the Diagnostics tab.</p>";
  }
  const report = inspectFeature(normalized, graph);
  return `<pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>`;
}

function diagnosticsTab(record: FeatureRecord): string {
  if (record.result.diagnostics.length === 0) return "<p>No findings.</p>";
  return record.result.diagnostics
    .map((d) => {
      const position = d.location !== undefined ? `:${d.location.line}:${d.location.column}` : "";
      return [
        `<div class="diagnostic ${escapeHtml(d.severity)}">`,
        `<strong>${escapeHtml(d.code)}</strong> ${escapeHtml(d.severity)} — ${escapeHtml(d.message)}`,
        `<div class="muted">${escapeHtml(record.target.display)}${position}</div>`,
        "</div>",
      ].join("");
    })
    .join("\n");
}

function refList(refs: readonly RelatedFeatureRef[]): string {
  if (refs.length === 0) return '<p class="muted">None.</p>';
  return `<ul>${refs
    .map((r) =>
      r.known
        ? `<li><a href="/features/${encodeURIComponent(r.id)}">${escapeHtml(r.name)}</a></li>`
        : `<li>${escapeHtml(r.name)} <span class="muted">(not found in this workspace)</span></li>`,
    )
    .join("\n")}</ul>`;
}

function relatedTab(related: RelatedFeatures): string {
  const eventsList =
    related.events.length === 0
      ? '<p class="muted">None.</p>'
      : `<ul>${related.events
          .map(
            (e) =>
              `<li><strong>${escapeHtml(e.event)}</strong> — <a href="/features/${encodeURIComponent(e.feature.id)}">${escapeHtml(e.feature.name)}</a> ${e.direction === "wait" ? "waits for it" : "publishes it"}</li>`,
          )
          .join("\n")}</ul>`;
  return [
    "<h3>Subflows called</h3>",
    refList(related.subflows),
    "<h3>Dependents (call this as a subflow)</h3>",
    refList(related.dependents),
    "<h3>Shared events</h3>",
    eventsList,
  ].join("\n");
}

const TABS = ["diagram", "steps", "source", "inspect", "diagnostics", "related"] as const;
type Tab = (typeof TABS)[number];

const TAB_SCRIPT = `
  var buttons = document.querySelectorAll("nav.tabs button");
  var panels = document.querySelectorAll(".tab-panel");
  function activateTab(tab) {
    buttons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    panels.forEach(function (p) { p.classList.toggle("active", p.dataset.tab === tab); });
  }
  buttons.forEach(function (b) { b.addEventListener("click", function () { activateTab(b.dataset.tab); }); });
  activateTab("diagram");
  var viewSelect = document.getElementById("diagram-view-select");
  if (viewSelect) {
    viewSelect.addEventListener("change", function () {
      document.querySelectorAll("[data-diagram-view]").forEach(function (el) {
        el.hidden = el.dataset.diagramView !== viewSelect.value;
      });
    });
  }
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    mermaid.run();
  }
`;

/** `GET /features/:id` — full detail: diagram, steps, source, inspect, diagnostics, related. */
export function renderFeatureDetailPage(record: FeatureRecord, related: RelatedFeatures): string {
  const counts = countBySeverity(record.result.diagnostics);
  const tabButtons = TABS.map(
    (tab, i) => `<button data-tab="${tab}"${i === 0 ? ' class="active"' : ""}>${tab}</button>`,
  ).join("\n");
  const panels: Record<Tab, string> = {
    diagram: diagramTab(record),
    steps: stepsTab(record),
    source: sourceTab(record),
    inspect: inspectTab(record),
    diagnostics: diagnosticsTab(record),
    related: relatedTab(related),
  };
  const body = [
    '<p><a href="/">&larr; Dashboard</a></p>',
    `<h1>${escapeHtml(record.name)} ${badge(record.result.valid, counts.error, counts.warning)}</h1>`,
    `<p class="muted">${escapeHtml(record.id)} · ${escapeHtml(record.target.display)}</p>`,
    `<nav class="tabs">${tabButtons}</nav>`,
    ...TABS.map(
      (tab, i) => `<div class="tab-panel${i === 0 ? " active" : ""}" data-tab="${tab}">${panels[tab]}</div>`,
    ),
  ].join("\n");
  return layout({
    title: `LogicSpec: ${record.name}`,
    body,
    head: '<script src="/assets/mermaid.min.js"></script>',
    script: TAB_SCRIPT,
  });
}
