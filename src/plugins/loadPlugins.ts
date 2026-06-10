import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isSeverity } from "../core/severity.js";
import type { DebtLensConfig, Detector } from "../core/types.js";

export interface PluginLoadResult {
  detectors: Detector[];
  warnings: string[];
}

const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function pluginsDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEBTLENS_DISABLE_PLUGINS === "1";
}

/**
 * Load third-party detectors from local ESM modules listed in config `plugins[]`.
 * Paths resolve relative to the config file directory and must stay within it;
 * exported detectors are validated against the built-in `Detector` contract and
 * must not collide with built-in or other plugin rule ids.
 * See docs/plugin-api-rfc.md for the full loading model.
 */
export async function loadPlugins(
  configDir: string,
  config: DebtLensConfig,
  builtInRuleIds: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PluginLoadResult> {
  const warnings: string[] = [];
  const pluginPaths = config.plugins ?? [];
  if (pluginPaths.length === 0) {
    return { detectors: [], warnings };
  }

  if (pluginsDisabled(env)) {
    warnings.push("plugins configured but skipped because DEBTLENS_DISABLE_PLUGINS=1");
    return { detectors: [], warnings };
  }

  const detectors: Detector[] = [];
  const seenRuleIds = new Set(builtInRuleIds);

  for (const pluginPath of pluginPaths) {
    const absolutePath = resolve(configDir, pluginPath);
    const relativeToConfig = relative(configDir, absolutePath);
    if (relativeToConfig.startsWith("..") || isAbsolute(relativeToConfig)) {
      throw new Error(
        `Plugin path "${pluginPath}" resolves outside the config directory; plugins must live within the repository.`,
      );
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Plugin module not found: ${absolutePath}`);
    }

    let moduleExports: { default?: unknown };
    try {
      moduleExports = await import(pathToFileURL(absolutePath).href) as { default?: unknown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load plugin "${pluginPath}": ${message}`);
    }

    const { rules, vocabulary } = normalizePluginExport(moduleExports.default, pluginPath);
    if (vocabulary) {
      warnings.push(`${pluginPath}: plugin vocabulary export is not supported yet and was ignored`);
    }

    for (const candidate of rules) {
      const detector = validateDetector(candidate, pluginPath);
      if (seenRuleIds.has(detector.id)) {
        throw new Error(
          `Plugin "${pluginPath}" exports rule id "${detector.id}", which collides with an existing rule.`,
        );
      }
      seenRuleIds.add(detector.id);
      detectors.push(detector);
    }
  }

  return { detectors, warnings };
}

function normalizePluginExport(
  exported: unknown,
  pluginPath: string,
): { rules: unknown[]; vocabulary?: Record<string, string[]> } {
  if (exported && typeof exported === "object" && "rules" in exported) {
    const shaped = exported as { rules: unknown; vocabulary?: Record<string, string[]> };
    if (!Array.isArray(shaped.rules)) {
      throw new Error(`Plugin "${pluginPath}" exports "rules" that is not an array.`);
    }
    return { rules: shaped.rules, vocabulary: shaped.vocabulary };
  }

  if (exported && typeof exported === "object") {
    return { rules: [exported] };
  }

  throw new Error(
    `Plugin "${pluginPath}" must default-export a Detector or { rules: Detector[] }; see docs/plugin-api-rfc.md.`,
  );
}

function validateDetector(candidate: unknown, pluginPath: string): Detector {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`Plugin "${pluginPath}" exports a rule that is not an object.`);
  }

  const detector = candidate as Partial<Detector>;
  const describe = (problem: string) =>
    new Error(`Plugin "${pluginPath}" rule ${JSON.stringify(detector.id ?? "<missing id>")}: ${problem}`);

  if (typeof detector.id !== "string" || !RULE_ID_PATTERN.test(detector.id)) {
    throw describe("\"id\" must be a lowercase kebab-case string.");
  }
  if (typeof detector.name !== "string" || detector.name.length === 0) {
    throw describe("\"name\" must be a non-empty string.");
  }
  if (typeof detector.description !== "string" || detector.description.length === 0) {
    throw describe("\"description\" must be a non-empty string.");
  }
  if (typeof detector.defaultSeverity !== "string" || !isSeverity(detector.defaultSeverity)) {
    throw describe("\"defaultSeverity\" must be one of info, low, medium, high.");
  }
  if (!Array.isArray(detector.tags) || detector.tags.some((tag) => typeof tag !== "string")) {
    throw describe("\"tags\" must be an array of strings.");
  }
  if (typeof detector.detect !== "function") {
    throw describe("\"detect\" must be a function.");
  }

  return detector as Detector;
}
