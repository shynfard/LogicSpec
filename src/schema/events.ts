import { z } from "zod";
import { extensionsSchema, identifierSchema, versionSchema } from "./common.js";

/** Link into an AsyncAPI document; verified against the document when present. */
const asyncApiRefSchema = z.strictObject({
  document: z.string().describe("Path of the AsyncAPI document, relative to this catalog."),
  channel: z.string().describe("Channel key (or address) inside the document."),
});

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
  asyncapi: asyncApiRefSchema.optional(),
  extensions: extensionsSchema.optional(),
});

export type AsyncApiRef = z.infer<typeof asyncApiRefSchema>;

export const eventsFileSchema = z.strictObject({
  version: versionSchema,
  events: z.record(identifierSchema, eventDefinitionSchema),
  extensions: extensionsSchema.optional(),
});

export type EventDefinition = z.infer<typeof eventDefinitionSchema>;
export type EventsFile = z.infer<typeof eventsFileSchema>;
