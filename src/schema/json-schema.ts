import { z } from "zod";
import { definitionsFileSchema } from "./definitions.js";
import { eventsFileSchema } from "./events.js";
import { featureFileSchemaWithRefs } from "./feature.js";
import { servicesFileSchema } from "./services.js";

export interface GeneratedSchema {
  /** Output file name, e.g. "feature.schema.json". */
  file: string;
  schema: Record<string, unknown>;
}

function generate(
  file: string,
  title: string,
  description: string,
  schema: z.ZodType,
): GeneratedSchema {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  return {
    file,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: `https://logicspec.dev/schemas/v1/${file}`,
      title,
      description,
      ...json,
    },
  };
}

/**
 * Generates the shipped JSON Schemas from the canonical Zod schemas.
 * Deterministic: same input schemas always produce byte-identical output.
 */
export function generateJsonSchemas(): GeneratedSchema[] {
  return [
    generate(
      "feature.schema.json",
      "LogicSpec Feature",
      "A LogicSpec feature specification (*.feature.yaml).",
      featureFileSchemaWithRefs,
    ),
    generate(
      "services.schema.json",
      "LogicSpec Service Catalog",
      "A LogicSpec service catalog (services.yaml).",
      servicesFileSchema,
    ),
    generate(
      "events.schema.json",
      "LogicSpec Event Catalog",
      "A LogicSpec event catalog (events.yaml).",
      eventsFileSchema,
    ),
    generate(
      "definitions.schema.json",
      "LogicSpec Shared Definitions",
      "A LogicSpec shared-definitions catalog (definitions.yaml).",
      definitionsFileSchema,
    ),
  ];
}
