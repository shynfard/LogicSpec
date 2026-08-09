import { z } from "zod";
import { versionSchema } from "./common.js";

export const renderDirectionSchema = z.enum(["TD", "TB", "LR", "RL", "BT"]);
export const renderViewSchema = z.enum(["flow", "swimlane"]);

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
    })
    .optional(),
  output: z
    .strictObject({
      directory: z.string().default("./generated"),
    })
    .default({ directory: "./generated" }),
  render: z
    .strictObject({
      view: renderViewSchema.default("flow"),
      direction: renderDirectionSchema.default("TD"),
    })
    .default({ view: "flow", direction: "TD" }),
});

export type RenderDirection = z.infer<typeof renderDirectionSchema>;
export type RenderView = z.infer<typeof renderViewSchema>;
export type LogicSpecConfig = z.infer<typeof configSchema>;

export const CONFIG_FILE_NAME = "logicspec.config.yaml";
