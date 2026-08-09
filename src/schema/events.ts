import { z } from "zod";
import { extensionsSchema, identifierSchema, versionSchema } from "./common.js";

export const eventDefinitionSchema = z.strictObject({
  topic: z.string().optional().describe("Broker topic, e.g. booking.created."),
  producer: identifierSchema.optional().describe("Service that publishes this event."),
  consumers: z.array(identifierSchema).optional(),
  description: z.string().optional(),
  payload: z
    .strictObject({
      schema: z.string().describe("Path or URL of the payload schema."),
    })
    .optional(),
  extensions: extensionsSchema.optional(),
});

export const eventsFileSchema = z.strictObject({
  version: versionSchema,
  events: z.record(identifierSchema, eventDefinitionSchema),
  extensions: extensionsSchema.optional(),
});

export type EventDefinition = z.infer<typeof eventDefinitionSchema>;
export type EventsFile = z.infer<typeof eventsFileSchema>;
