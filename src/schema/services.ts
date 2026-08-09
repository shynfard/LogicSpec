import { z } from "zod";
import { extensionsSchema, identifierSchema, versionSchema } from "./common.js";

const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const operationCommon = {
  description: z.string().optional(),
  extensions: extensionsSchema.optional(),
};

const httpOperationSchema = z.strictObject({
  kind: z.literal("http"),
  method: httpMethodSchema,
  path: z.string(),
  ...operationCommon,
});

const grpcOperationSchema = z.strictObject({
  kind: z.literal("grpc"),
  service: z.string(),
  method: z.string(),
  ...operationCommon,
});

const internalOperationSchema = z.strictObject({
  kind: z.literal("internal"),
  operation: z.string().optional(),
  ...operationCommon,
});

const commandOperationSchema = z.strictObject({
  kind: z.literal("command"),
  command: z.string().optional(),
  ...operationCommon,
});

const otherOperationSchema = z.strictObject({
  kind: z.literal("other"),
  protocol: z.string().optional(),
  ...operationCommon,
});

export const serviceOperationSchema = z.discriminatedUnion("kind", [
  httpOperationSchema,
  grpcOperationSchema,
  internalOperationSchema,
  commandOperationSchema,
  otherOperationSchema,
]);

export const serviceSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string().optional(),
  operations: z.record(identifierSchema, serviceOperationSchema),
  extensions: extensionsSchema.optional(),
});

export const servicesFileSchema = z.strictObject({
  version: versionSchema,
  services: z.record(identifierSchema, serviceSchema),
  extensions: extensionsSchema.optional(),
});

export type ServiceOperation = z.infer<typeof serviceOperationSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type ServicesFile = z.infer<typeof servicesFileSchema>;
