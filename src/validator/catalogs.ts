import path from "node:path";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { suggest, withSuggestion } from "../diagnostics/suggest.js";
import type { Workspace } from "../workspace/loader.js";

/**
 * Validates catalog-level references that point OUT of the workspace:
 * OpenAPI operation links on service operations (LS108, LS403) and AsyncAPI
 * channel links on events (LS109). These are catalog problems, so they are
 * reported once per workspace, not once per feature.
 */
export function validateCatalogs(workspace: Workspace): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const servicesPath = workspace.catalogPaths.services;
  if (workspace.services && servicesPath !== undefined) {
    const locate = workspace.catalogLocators.services ?? (() => undefined);
    for (const [serviceId, service] of Object.entries(workspace.services.services)) {
      for (const [operationId, operation] of Object.entries(service.operations)) {
        if (operation.openapi === undefined) continue;
        const documentPath = path.resolve(path.dirname(servicesPath), operation.openapi.document);
        const document = workspace.openApiDocuments.get(documentPath);
        if (document === undefined) continue; // unreadable → already LS004/LS001
        const basePath = ["services", serviceId, "operations", operationId, "openapi"];

        if (!document.operationIds.has(operation.openapi.operationId)) {
          const suggestion = suggest(operation.openapi.operationId, document.operationIds);
          diagnostics.push(
            makeDiagnostic(CODES.UNKNOWN_OPENAPI_OPERATION, {
              message: withSuggestion(
                `Operation "${serviceId}.${operationId}" references operationId "${operation.openapi.operationId}" which does not exist in ${operation.openapi.document}.`,
                suggestion,
              ),
              file: servicesPath,
              path: [...basePath, "operationId"],
              location: locate([...basePath, "operationId"]),
              suggestion,
            }),
          );
          continue;
        }

        if (operation.kind === "http") {
          const linked = document.operations.find(
            (candidate) => candidate.operationId === operation.openapi?.operationId,
          );
          if (
            linked !== undefined &&
            (linked.method !== operation.method || linked.path !== operation.path)
          ) {
            diagnostics.push(
              makeDiagnostic(CODES.OPENAPI_MISMATCH, {
                message: `Operation "${serviceId}.${operationId}" is declared as ${operation.method} ${operation.path} but ${operation.openapi.document} defines "${operation.openapi.operationId}" as ${linked.method} ${linked.path}.`,
                file: servicesPath,
                path: basePath,
                location: locate(basePath),
              }),
            );
          }
        }
      }
    }
  }

  const eventsPath = workspace.catalogPaths.events;
  if (workspace.events && eventsPath !== undefined) {
    const locate = workspace.catalogLocators.events ?? (() => undefined);
    for (const [eventName, event] of Object.entries(workspace.events.events)) {
      if (event.asyncapi === undefined) continue;
      const documentPath = path.resolve(path.dirname(eventsPath), event.asyncapi.document);
      const document = workspace.asyncApiDocuments.get(documentPath);
      if (document === undefined) continue;
      if (!document.channels.has(event.asyncapi.channel)) {
        const suggestion = suggest(event.asyncapi.channel, document.channels);
        const refPath = ["events", eventName, "asyncapi", "channel"];
        diagnostics.push(
          makeDiagnostic(CODES.UNKNOWN_ASYNCAPI_CHANNEL, {
            message: withSuggestion(
              `Event "${eventName}" references channel "${event.asyncapi.channel}" which does not exist in ${event.asyncapi.document}.`,
              suggestion,
            ),
            file: eventsPath,
            path: refPath,
            location: locate(refPath),
            suggestion,
          }),
        );
      }
    }
  }

  return diagnostics;
}
