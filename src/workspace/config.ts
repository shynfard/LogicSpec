import fs from "node:fs";
import path from "node:path";
import { CODES } from "../diagnostics/codes.js";
import { type Diagnostic, makeDiagnostic } from "../diagnostics/diagnostic.js";
import { loadYaml } from "../parser/yaml.js";
import { zodIssuesToDiagnostics } from "../parser/zod-issues.js";
import { CONFIG_FILE_NAME, configSchema, type LogicSpecConfig } from "../schema/config.js";

export interface LoadedConfig {
  ok: boolean;
  /** Directory containing the config file; all config paths resolve from here. */
  root: string;
  configPath?: string;
  config: LogicSpecConfig;
  diagnostics: Diagnostic[];
}

export const DEFAULT_CONFIG: LogicSpecConfig = configSchema.parse({ version: "1" });

/** Walks up from startDir looking for logicspec.config.yaml. */
export function findConfigPath(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, CONFIG_FILE_NAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Loads the nearest workspace config. Without a config file, defaults apply
 * and catalog-dependent validation is skipped.
 */
export function loadConfig(startDir: string): LoadedConfig {
  const configPath = findConfigPath(startDir);
  if (configPath === undefined) {
    return {
      ok: true,
      root: path.resolve(startDir),
      config: DEFAULT_CONFIG,
      diagnostics: [],
    };
  }

  const root = path.dirname(configPath);
  let source: string;
  try {
    source = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      root,
      configPath,
      config: DEFAULT_CONFIG,
      diagnostics: [
        makeDiagnostic(CODES.FILE_ERROR, {
          message: `Cannot read config: ${(error as Error).message}`,
          file: configPath,
        }),
      ],
    };
  }

  const yaml = loadYaml(source, configPath);
  if (!yaml.ok) {
    return { ok: false, root, configPath, config: DEFAULT_CONFIG, diagnostics: yaml.diagnostics };
  }

  const parsed = configSchema.safeParse(yaml.value);
  if (!parsed.success) {
    const diagnostics = zodIssuesToDiagnostics(
      parsed.error.issues,
      yaml.value,
      yaml.locate,
      configPath,
    ).map((d) => ({ ...d, code: CODES.CONFIG_ERROR.code, name: CODES.CONFIG_ERROR.name }));
    return { ok: false, root, configPath, config: DEFAULT_CONFIG, diagnostics };
  }

  return { ok: true, root, configPath, config: parsed.data, diagnostics: [] };
}
