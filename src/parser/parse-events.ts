import { type EventsFile, eventsFileSchema } from "../schema/events.js";
import type { ParseOptions, ParseResult } from "./parse-feature.js";
import { loadYaml } from "./yaml.js";
import { zodIssuesToDiagnostics } from "./zod-issues.js";

/** Parses and validates an event catalog (events.yaml). */
export function parseEvents(source: string, options: ParseOptions = {}): ParseResult<EventsFile> {
  const { file } = options;
  const yaml = loadYaml(source, file);
  if (!yaml.ok) {
    return { ok: false, diagnostics: yaml.diagnostics, locate: yaml.locate };
  }

  const parsed = eventsFileSchema.safeParse(yaml.value);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: zodIssuesToDiagnostics(parsed.error.issues, yaml.value, yaml.locate, file),
      locate: yaml.locate,
    };
  }

  return { ok: true, data: parsed.data, diagnostics: [], locate: yaml.locate };
}
