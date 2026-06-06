import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as DebtLensConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read DebtLens config at ${configPath}: ${message}`);
  }
}
