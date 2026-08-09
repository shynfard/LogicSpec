import type { FeatureGraph } from "../graph/edges.js";
import type { NormalizedFeature } from "../graph/normalize.js";
import type { RenderDirection, RenderView } from "../schema/config.js";
import { renderMermaidFlowchart } from "./mermaid-flowchart.js";
import { renderMermaidSwimlane } from "./mermaid-swimlane.js";

export interface RenderOptions {
  view?: RenderView;
  direction?: RenderDirection;
  /** Source path shown in the generated-file warning. */
  source?: string;
}

/** Renders the requested Mermaid view of a feature. */
export function renderMermaid(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  options: RenderOptions = {},
): string {
  if (options.view === "swimlane") {
    return renderMermaidSwimlane(feature, graph, { direction: options.direction });
  }
  return renderMermaidFlowchart(graph, { direction: options.direction });
}

/**
 * Wraps the Mermaid diagram in a Markdown document with a generated-file
 * warning. The YAML specification stays authoritative — this output is
 * documentation only and must never be edited by hand.
 */
export function renderMarkdown(
  feature: NormalizedFeature,
  graph: FeatureGraph,
  options: RenderOptions = {},
): string {
  const mermaid = renderMermaid(feature, graph, options);
  const lines: string[] = [];

  lines.push(`# ${feature.name}`);
  lines.push("");
  lines.push("> **GENERATED FILE — DO NOT EDIT.**");
  if (options.source) {
    lines.push(">");
    lines.push(`> Source: \`${options.source}\``);
    lines.push(`> Regenerate with \`logicspec render ${options.source}\`.`);
  }
  lines.push("");
  if (feature.description) {
    lines.push(feature.description.trim());
    lines.push("");
  }
  lines.push("```mermaid");
  lines.push(mermaid.trimEnd());
  lines.push("```");
  lines.push("");

  if (feature.actors.length > 0) {
    lines.push("## Actors");
    lines.push("");
    for (const actor of feature.actors) {
      lines.push(`- **${actor.label}** (\`${actor.id}\`, ${actor.kind})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
