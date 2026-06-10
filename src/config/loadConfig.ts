import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEBTLENS_PLUGIN_API_VERSION } from "../plugins/version.js";
import type { DebtLensConfig } from "../core/types.js";

const configNames = [
  "debtlens.config.json",
  ".debtlensrc.json"
];

export function findConfigPath(cwd: string, explicitPath?: string): string | undefined {
  if (explicitPath) {
    return resolve(cwd, explicitPath);
  }

  return configNames.map((name) => resolve(cwd, name)).find((candidate) => existsSync(candidate));
}

export function loadConfig(cwd: string, explicitPath?: string): DebtLensConfig {
  const configPath = findConfigPath(cwd, explicitPath);

  if (!configPath || !existsSync(configPath)) {
    return {};
  }

  let config: DebtLensConfig;
  try {
    const raw = readFileSync(configPath, "utf8");
    config = JSON.parse(raw) as DebtLensConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read DebtLens config at ${configPath}: ${message}`);
  }

  validatePluginApiVersion(config, configPath);
  return config;
}

function validatePluginApiVersion(config: DebtLensConfig, configPath: string): void {
  if (config.plugins?.length && config.pluginApiVersion === undefined) {
    throw new Error(
      `${configPath}: "plugins" requires "pluginApiVersion": ${DEBTLENS_PLUGIN_API_VERSION} so DebtLens can fail fast on incompatible plugin APIs.`,
    );
  }

  if (config.pluginApiVersion !== undefined && config.pluginApiVersion !== DEBTLENS_PLUGIN_API_VERSION) {
    throw new Error(
      `${configPath}: pluginApiVersion ${config.pluginApiVersion} is not supported by this DebtLens release ` +
      `(supported: ${DEBTLENS_PLUGIN_API_VERSION}). Upgrade DebtLens or adjust the config; see docs/plugin-api-rfc.md.`,
    );
  }
}
