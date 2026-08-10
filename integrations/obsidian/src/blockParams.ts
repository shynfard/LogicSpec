import type { RenderDirection, RenderView } from "logicspec/core";
import { parse } from "yaml";

export const VIEWS: readonly RenderView[] = ["flow", "swimlane", "sequence", "event-model"];
export const DIRECTIONS: readonly RenderDirection[] = ["TD", "TB", "LR", "RL", "BT"];

export interface FileBlockParams {
  /** Vault-relative path of the feature file. */
  file: string;
  view?: RenderView;
  direction?: RenderDirection;
}

export interface ParsedFileBlock {
  params?: FileBlockParams;
  errors: string[];
}

/**
 * Parses the body of a ```logicspec-file block:
 *
 *   file: features/booking.feature.yaml
 *   view: swimlane          # optional
 *   direction: LR           # optional
 *
 * Pure and side-effect free; all problems come back as user-facing strings.
 */
export function parseFileBlock(source: string): ParsedFileBlock {
  let value: unknown;
  try {
    value = parse(source);
  } catch (error) {
    return { errors: [`The block is not valid YAML: ${(error as Error).message}`] };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      errors: ['The block must be a YAML map, e.g. "file: features/booking.feature.yaml".'],
    };
  }

  const record = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(record)) {
    if (key !== "file" && key !== "view" && key !== "direction") {
      errors.push(`Unknown key "${key}". Allowed keys: file, view, direction.`);
    }
  }

  const file = record.file;
  if (typeof file !== "string" || file.trim() === "") {
    errors.push('Missing required "file": a vault-relative path to a *.feature.yaml document.');
  }

  let view: RenderView | undefined;
  if (record.view !== undefined) {
    if (typeof record.view === "string" && (VIEWS as readonly string[]).includes(record.view)) {
      view = record.view as RenderView;
    } else {
      errors.push(`Invalid "view" ${JSON.stringify(record.view)}. Allowed: ${VIEWS.join(", ")}.`);
    }
  }

  let direction: RenderDirection | undefined;
  if (record.direction !== undefined) {
    if (
      typeof record.direction === "string" &&
      (DIRECTIONS as readonly string[]).includes(record.direction)
    ) {
      direction = record.direction as RenderDirection;
    } else {
      errors.push(
        `Invalid "direction" ${JSON.stringify(record.direction)}. Allowed: ${DIRECTIONS.join(", ")}.`,
      );
    }
  }

  if (errors.length > 0) return { errors };
  return { params: { file: (file as string).trim(), view, direction }, errors: [] };
}
