import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { mergeDebtLensConfig } from "../config/loadConfig.js";
import { buildCalibrateSuggestions, renderCalibrateReport } from "../core/calibrate.js";
import { calibrationThresholdOverrides } from "./adoptionThresholds.js";
import { scan } from "../core/scan.js";
import { parseSeverity } from "../core/severity.js";
import { loadConfiguredPlugins } from "./scanPipeline.js";
import { parseCommaList, parseInteger, parseRuleList, parseThresholds } from "./parse.js";

export interface CalibrateInput {
  target: string;
  cwd: string;
  configPath?: string;
  percentile?: number;
  write?: boolean;
  cliOptions?: Record<string, unknown>;
}

export async function runCalibrate(input: CalibrateInput): Promise<string> {
  const cwd = resolve(input.cwd);
  const effectiveConfig = loadEffectiveConfig(cwd, input.configPath);
  const pluginContribution = await loadConfiguredPlugins(cwd, input.cliOptions ?? {}, effectiveConfig.config, effectiveConfig.pluginConfigDir);
  const options = mergeConfig(input.target, effectiveConfig.config, {
    cwd,
    include: parseCommaList(input.cliOptions?.include as string | undefined),
    exclude: parseCommaList(input.cliOptions?.exclude as string | undefined),
    rules: parseRuleList(input.cliOptions?.rules as string | undefined),
    pack: input.cliOptions?.pack ? String(input.cliOptions.pack) : undefined,
    thresholds: parseThresholds(input.cliOptions?.threshold as string | undefined),
    minSeverity: parseSeverity(String(input.cliOptions?.minSeverity ?? "low"), "low"),
    maxFiles: input.cliOptions?.maxFiles as number | undefined,
    respectGitignore: input.cliOptions?.respectGitignore === true ? true : undefined,
    pluginDetectors: pluginContribution?.detectors,
    pluginThresholds: pluginContribution?.thresholds,
    pluginVocabulary: pluginContribution?.vocabulary,
  });
  const result = await scan({
    ...options,
    thresholds: {
      ...options.thresholds,
      ...calibrationThresholdOverrides(options.rules),
    },
  });
  const calibrate = buildCalibrateSuggestions(result, options, {
    percentile: input.percentile ?? 90,
  });
  if (input.write && calibrate.suggestions.length > 0) {
    const configPath = resolve(cwd, input.configPath ?? "debtlens.config.json");
    const existing = effectiveConfig.config;
    const merged = mergeDebtLensConfig(existing, {
      thresholds: Object.fromEntries(calibrate.suggestions.map((suggestion) => [suggestion.key, suggestion.suggested])),
    });
    writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }
  return renderCalibrateReport(calibrate);
}
