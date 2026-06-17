import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

export function findLocalConfigPath(cwd: string): string | undefined {
  return configNames.map((name) => resolve(cwd, name)).find((candidate) => existsSync(candidate));
}

export function loadConfig(cwd: string, explicitPath?: string): DebtLensConfig {
  const configPath = findConfigPath(cwd, explicitPath);

  if (!configPath || !existsSync(configPath)) {
    return {};
  }

  return loadConfigAtPath(configPath);
}

export interface EffectiveConfig {
  config: DebtLensConfig;
  paths: string[];
  pluginConfigDir: string;
}

export function loadEffectiveConfig(
  cwd: string,
  explicitPath?: string,
  packageDirectory?: string,
): EffectiveConfig {
  const rootConfigPath = findConfigPath(cwd, explicitPath);
  const rootConfig = rootConfigPath && existsSync(rootConfigPath)
    ? loadConfigAtPath(rootConfigPath)
    : {};
  const packageConfigPath = packageDirectory ? findLocalConfigPath(packageDirectory) : undefined;
  const shouldLoadPackageConfig = packageConfigPath !== undefined && packageConfigPath !== rootConfigPath;
  const packageConfig = shouldLoadPackageConfig
    ? loadConfigAtPath(packageConfigPath)
    : undefined;
  const paths = [
    rootConfigPath && existsSync(rootConfigPath) ? rootConfigPath : undefined,
    shouldLoadPackageConfig ? packageConfigPath : undefined,
  ].filter((path): path is string => path !== undefined);

  return {
    config: packageConfig ? mergeDebtLensConfig(rootConfig, packageConfig) : rootConfig,
    paths,
    pluginConfigDir: packageConfig?.plugins?.length && packageConfigPath
      ? dirname(packageConfigPath)
      : rootConfigPath
        ? dirname(rootConfigPath)
        : cwd,
  };
}

export function mergeDebtLensConfig(base: DebtLensConfig, override: DebtLensConfig): DebtLensConfig {
  return stripUndefined({
    ...base,
    ...override,
    include: mergeStringArrays(base.include, override.include),
    exclude: mergeStringArrays(base.exclude, override.exclude),
    rules: mergeStringArrays(base.rules, override.rules),
    thresholds: mergeRecord(base.thresholds, override.thresholds),
    vocabulary: mergeRecord(base.vocabulary, override.vocabulary),
    propDrilling: mergeRecord(base.propDrilling, override.propDrilling),
    namingDrift: mergeRecord(base.namingDrift, override.namingDrift),
    todoComment: mergeRecord(base.todoComment, override.todoComment),
    ruleSeverities: mergeRecord(base.ruleSeverities, override.ruleSeverities),
    ruleConfidenceFloors: mergeRecord(base.ruleConfidenceFloors, override.ruleConfidenceFloors),
  });
}

function mergeStringArrays(base?: string[], override?: string[]): string[] | undefined {
  if (!base?.length && !override?.length) return undefined;
  return unique([...(base ?? []), ...(override ?? [])]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function loadConfigAtPath(configPath: string): DebtLensConfig {
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

function mergeRecord<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) } as T;
}

function stripUndefined(config: DebtLensConfig): DebtLensConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as DebtLensConfig;
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
