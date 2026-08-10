import {
  type Diagnostic,
  type RenderDirection,
  type RenderView,
  renderMermaid,
  validateFeature,
} from "logicspec/core";

export interface RenderBlockOptions {
  view: RenderView;
  direction: RenderDirection;
}

export interface RenderBlockResult {
  /** Mermaid source, present only when the specification is valid. */
  mermaid?: string;
  valid: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Validates one feature specification and, when valid, renders the requested
 * Mermaid view. Pure (no Obsidian imports) so it is unit-testable; an
 * invalid specification never yields a diagram — stale or misleading output
 * is worse than none.
 */
export function renderFeatureBlock(
  source: string,
  options: RenderBlockOptions,
): RenderBlockResult {
  const result = validateFeature(source);
  if (result.valid && result.normalized && result.graph) {
    return {
      mermaid: renderMermaid(result.normalized, result.graph, {
        view: options.view,
        direction: options.direction,
      }),
      valid: true,
      diagnostics: result.diagnostics,
    };
  }
  return { valid: false, diagnostics: result.diagnostics };
}
