import { z } from "zod";
import { versionSchema } from "./common.js";

export const renderDirectionSchema = z.enum(["TD", "TB", "LR", "RL", "BT"]);
export const renderViewSchema = z.enum(["flow", "swimlane", "sequence", "event-model"]);

/** Per-code severity override: promote, demote or disable a diagnostic. */
export const severityOverrideSchema = z.enum(["error", "warning", "info", "off"]);

export const configSchema = z.strictObject({
  version: versionSchema,
  features: z
    .strictObject({
      directory: z.string().default("./features"),
    })
    .default({ directory: "./features" }),
  catalogs: z
    .strictObject({
      services: z.string().optional(),
      events: z.string().optional(),
      definitions: z
        .string()
        .optional()
        .describe("Path to the shared-definitions catalog (definitions.yaml) for $ref reuse."),
    })
    .optional(),
  output: z
    .strictObject({
      directory: z.string().default("./.logicspec"),
    })
    .default({ directory: "./.logicspec" }),
  render: z
    .strictObject({
      view: renderViewSchema.default("flow"),
      direction: renderDirectionSchema.default("TD"),
    })
    .default({ view: "flow", direction: "TD" }),
  diagnostics: z
    .record(
      z.string().regex(/^LS\d{3}$/, 'diagnostic codes look like "LS200"'),
      severityOverrideSchema,
    )
    .optional()
    .describe('Per-code severity overrides, e.g. { LS200: "error", LS402: "off" }.'),
});

export type RenderDirection = z.infer<typeof renderDirectionSchema>;
export type RenderView = z.infer<typeof renderViewSchema>;
export type SeverityOverride = z.infer<typeof severityOverrideSchema>;
export type LogicSpecConfig = z.infer<typeof configSchema>;

export const CONFIG_FILE_NAME = "logicspec.config.yaml";
