import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findConfigPath, findLocalConfigPath, loadEffectiveConfig, type EffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { validateConfigShape } from "../config/validateConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { allDetectors, detectorIds } from "../detectors/index.js";
import { resolveFilePaths } from "../core/resolveFiles.js";
import { defaultConfig } from "../config/defaults.js";
import { getRulePack } from "../config/packs.js";
import { loadPlugins } from "../plugins/loadPlugins.js";
import type { CliOptions, DebtLensConfig, ScanOptions, ScanThresholds } from "../core/types.js";
import { getChangedFiles, getStagedFiles, isGitRepo } from "../utils/git.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export interface DoctorInput {
  target: string;
  cwd: string;
  configPath?: string;
  packageName?: string;
  baselinePath?: string;
  usedChanged: boolean;
  usedStaged: boolean;
  changedIgnored: boolean;
  stagedIgnored: boolean;
  gitChangedCount?: number;
  gitStagedCount?: number;
  cliOptions: CliOptions;
  cliSources?: DoctorCliSources;
  showProvenance?: boolean;
}

export interface DoctorReport {
  text: string;
  ok: boolean;
}

export interface DoctorCliSources {
  include?: boolean;
  exclude?: boolean;
  minSeverity?: boolean;
  pack?: boolean;
  rules?: boolean;
  thresholds?: boolean;
  maxFiles?: boolean;
  respectGitignore?: boolean;
}

interface DoctorPluginContribution {
  thresholds?: ScanThresholds;
  vocabulary?: Record<string, string[]>;
  warnings: string[];
}

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  let target = input.target;
  let packageDirectory: string | undefined;
  if (input.packageName) {
    const workspacePackage = resolveWorkspacePackage(input.cwd, input.packageName);
    packageDirectory = workspacePackage.directory;
    target = packageDirectory;
  }

  const configPath = findConfigPath(input.cwd, input.configPath);
  const packageConfigPath = packageDirectory ? findLocalConfigPath(packageDirectory) : undefined;
  const explicitConfigPath = input.configPath ? resolve(input.cwd, input.configPath) : undefined;
  const missingConfigPath = explicitConfigPath && !existsSync(explicitConfigPath)
    ? explicitConfigPath
    : undefined;
  const displayConfigPaths = [
    configPath && existsSync(configPath) ? configPath : undefined,
    packageConfigPath && packageConfigPath !== configPath ? packageConfigPath : undefined,
  ].filter((path): path is string => path !== undefined);
  const configValidation = combineConfigValidations([
    { path: configPath, result: validateConfigAtPath(configPath, missingConfigPath) },
    packageConfigPath && packageConfigPath !== configPath
      ? { path: packageConfigPath, result: validateConfigAtPath(packageConfigPath, undefined) }
      : undefined,
  ]);
  const effectiveConfig = configValidation.state === "invalid"
    ? { config: {}, paths: [], pluginConfigDir: input.cwd }
    : loadEffectiveConfig(input.cwd, input.configPath, packageDirectory);
  const fileConfig = configValidation.state === "invalid"
    ? {}
    : effectiveConfig.config;
  const pluginContribution = input.showProvenance && configValidation.state !== "invalid"
    ? await loadPluginContributionForDoctor(effectiveConfig, fileConfig)
    : { warnings: [] };
  const options = mergeConfig(target, fileConfig, {
    ...input.cliOptions,
    ...(pluginContribution.thresholds ? { pluginThresholds: pluginContribution.thresholds } : {}),
    ...(pluginContribution.vocabulary ? { pluginVocabulary: pluginContribution.vocabulary } : {}),
  });
  const filePaths = await resolveFilePaths(options);
  const resolvedRules = resolveRuleIds(options);
  const warnings = missingConfigPath
    ? [`DebtLens warning: config file not found at ${missingConfigPath}.`]
    : configValidation.state === "invalid"
      ? [`DebtLens warning: config schema validation failed: ${configValidation.errors.join("; ")}.`]
    : [];

  const lines = [
    "DebtLens Doctor",
    "===============",
    `Working directory: ${options.cwd}`,
    `Config: ${formatConfigPaths(missingConfigPath, displayConfigPaths)}`,
    `Config schema: ${formatConfigSchemaStatus(configValidation)}`,
    `Target: ${options.target}`,
    ...(input.packageName ? [`Package: ${input.packageName}`] : []),
    `Pack: ${options.pack ?? "(none)"}`,
    `Rules: ${resolvedRules.join(", ")}`,
    `Thresholds: ${formatThresholds(options.thresholds)}`,
    `Min severity: ${options.minSeverity}`,
    `Max files: ${options.maxFiles ?? "(unlimited)"}`,
    `Include globs: ${options.include.join(", ")}`,
    `Exclude globs: ${options.exclude.join(", ")}`,
    `Respect gitignore: ${options.respectGitignore ? "yes" : "no"}`,
    `Git repository: ${isGitRepo(input.cwd) ? "yes" : "no"}`,
  ];

  if (input.baselinePath) {
    lines.push(`Baseline: ${resolve(input.cwd, input.baselinePath)}`);
  }

  if (input.usedChanged) {
    if (input.changedIgnored) {
      lines.push("Changed mode: ignored (not a git repository)");
    } else {
      lines.push(`Changed mode: ${input.gitChangedCount ?? 0} file(s) from git diff`);
    }
  }

  if (input.usedStaged) {
    if (input.stagedIgnored) {
      lines.push("Staged mode: ignored (not a git repository)");
    } else {
      lines.push(`Staged mode: ${input.gitStagedCount ?? 0} file(s) from git index`);
    }
  }

  lines.push(`Matched files: ${filePaths.length}`);

  if (input.showProvenance && configValidation.state !== "invalid") {
    lines.push("");
    lines.push(...formatProvenance({
      effectiveConfig,
      cliOptions: input.cliOptions,
      cliSources: input.cliSources ?? {},
      options,
      pluginContribution,
    }));
  }

  const allWarnings = [
    ...warnings,
    ...pluginContribution.warnings.map((warning) => `DebtLens warning: ${warning}`),
  ];
  if (allWarnings.length) {
    lines.push("");
    lines.push(...allWarnings);
  }

  if (filePaths.length === 0) {
    lines.push("");
    lines.push(buildZeroFilesScannedWarning(
      options.target,
      options.include,
      input.usedChanged || input.usedStaged,
    ).trimEnd());
  }

  return { text: `${lines.join("\n")}\n`, ok: configValidation.state !== "invalid" };
}

async function loadPluginContributionForDoctor(
  effectiveConfig: EffectiveConfig,
  fileConfig: DebtLensConfig,
): Promise<DoctorPluginContribution> {
  if (!fileConfig.plugins?.length) return { warnings: [] };
  const loaded = await loadPlugins(effectiveConfig.pluginConfigDir, fileConfig, new Set(detectorIds));
  return {
    thresholds: Object.keys(loaded.thresholds).length ? loaded.thresholds : undefined,
    vocabulary: Object.keys(loaded.vocabulary).length ? loaded.vocabulary : undefined,
    warnings: loaded.warnings,
  };
}

function validateConfigAtPath(configPath: string | undefined, missingConfigPath: string | undefined): ConfigValidationResultForDoctor {
  if (!configPath || missingConfigPath || !existsSync(configPath)) {
    return { state: "not-found" };
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const validation = validateConfigShape(parsed);
    return validation.valid
      ? { state: "valid" }
      : { state: "invalid", errors: validation.errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { state: "invalid", errors: [`could not parse config JSON: ${message}`] };
  }
}

type ConfigValidationResultForDoctor =
  | { state: "not-found" }
  | { state: "valid" }
  | { state: "invalid"; errors: string[] };

interface NamedConfigValidation {
  path?: string;
  result: ConfigValidationResultForDoctor;
}

function combineConfigValidations(
  validations: Array<NamedConfigValidation | undefined>,
): ConfigValidationResultForDoctor {
  const present = validations.filter((entry): entry is NamedConfigValidation => entry !== undefined);
  const invalid = present.filter((entry) => entry.result.state === "invalid");
  if (invalid.length > 0) {
    return {
      state: "invalid",
      errors: invalid.flatMap((entry) => {
        const prefix = entry.path ? `${entry.path}: ` : "";
        return entry.result.state === "invalid"
          ? entry.result.errors.map((error) => `${prefix}${error}`)
          : [];
      }),
    };
  }
  return present.some((entry) => entry.result.state === "valid")
    ? { state: "valid" }
    : { state: "not-found" };
}

function formatConfigSchemaStatus(result: ConfigValidationResultForDoctor): string {
  if (result.state === "not-found") return "(not checked)";
  if (result.state === "valid") return "valid";
  return `invalid (${result.errors.join("; ")})`;
}

function formatConfigPaths(missingConfigPath: string | undefined, configPaths: string[]): string {
  if (missingConfigPath) return `${missingConfigPath} (missing)`;
  if (configPaths.length === 0) return "(none found)";
  return configPaths.join(" + ");
}

function formatThresholds(thresholds: ScanOptions["thresholds"]): string {
  const entries = Object.entries(thresholds).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "(none)";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function resolveRuleIds(options: ScanOptions): string[] {
  if (options.rules?.length) {
    return options.rules;
  }

  return allDetectors.map((detector) => detector.id);
}

function formatProvenance(input: {
  effectiveConfig: EffectiveConfig;
  cliOptions: CliOptions;
  cliSources: DoctorCliSources;
  options: ScanOptions;
  pluginContribution: DoctorPluginContribution;
}): string[] {
  const sourceContext = buildSourceContext(input.effectiveConfig);
  const packIds = input.options.pack?.split(",").filter(Boolean) ?? [];
  const thresholdSources = buildThresholdSources(input.effectiveConfig, packIds, input.pluginContribution.thresholds, input.cliOptions.thresholds);
  const vocabularySources = buildVocabularySources(input.effectiveConfig, input.pluginContribution.vocabulary);
  const lines = [
    "Provenance",
    "----------",
    `Pack: ${formatPackSource(input.effectiveConfig, input.cliSources)}`,
    `Rules: ${formatRulesSource(input.effectiveConfig, input.cliSources, packIds)}`,
    `Include globs: ${formatIncludeSource(input.effectiveConfig, input.cliSources, input.options.include, packIds)}`,
    `Exclude globs: ${formatLayeredSource([
      "defaults",
      ...configFieldSources(input.effectiveConfig, "exclude"),
      ...(input.cliSources.exclude ? ["CLI --exclude"] : []),
    ])}`,
    `Min severity: ${formatScalarSource(input.effectiveConfig, input.cliSources.minSeverity, "minSeverity", "CLI --min-severity", "defaults")}`,
    `Max files: ${formatScalarSource(input.effectiveConfig, input.cliSources.maxFiles, "maxFiles", "CLI --max-files", "defaults")}`,
    `Respect gitignore: ${formatScalarSource(input.effectiveConfig, input.cliSources.respectGitignore, "respectGitignore", "CLI --respect-gitignore", "defaults")}`,
    `Plugins: ${formatLayeredSource(configFieldSources(input.effectiveConfig, "plugins"), "(none)")}`,
    "Thresholds:",
    ...Object.keys(input.options.thresholds).sort((left, right) => left.localeCompare(right)).map((key) =>
      `  ${key}: ${thresholdSources.get(key) ?? "unknown"}`),
    "Vocabulary:",
    ...formatVocabularyLines(input.options.vocabulary, vocabularySources),
  ];

  if (sourceContext.length) {
    lines.push("Config sources:");
    lines.push(...sourceContext.map((source) => `  ${source}`));
  }

  return lines;
}

function buildSourceContext(effectiveConfig: EffectiveConfig): string[] {
  return [
    effectiveConfig.rootConfigPath ? `root config: ${effectiveConfig.rootConfigPath}` : undefined,
    effectiveConfig.packageConfigPath ? `package config: ${effectiveConfig.packageConfigPath}` : undefined,
  ].filter((entry): entry is string => entry !== undefined);
}

function buildThresholdSources(
  effectiveConfig: EffectiveConfig,
  packIds: string[],
  pluginThresholds: ScanThresholds | undefined,
  cliThresholds: ScanThresholds | undefined,
): Map<string, string> {
  const sources = new Map<string, string>();
  setRecordSources(sources, defaultConfig.thresholds, "defaults");
  for (const packId of packIds) {
    setRecordSources(sources, getRulePack(packId).thresholds, `pack "${packId}" defaults`);
  }
  setRecordSources(sources, pluginThresholds, "plugin defaults");
  setRecordSources(sources, effectiveConfig.rootConfig?.thresholds, sourceLabel("root config", effectiveConfig.rootConfigPath));
  setRecordSources(sources, effectiveConfig.packageConfig?.thresholds, sourceLabel("package config", effectiveConfig.packageConfigPath));
  setRecordSources(sources, cliThresholds, "CLI --threshold");
  return sources;
}

function buildVocabularySources(
  effectiveConfig: EffectiveConfig,
  pluginVocabulary: Record<string, string[]> | undefined,
): Map<string, string> {
  const sources = new Map<string, string>();
  setRecordSources(sources, defaultConfig.vocabulary, "defaults");
  setRecordSources(sources, pluginVocabulary, "plugin defaults");
  setRecordSources(sources, effectiveConfig.rootConfig?.vocabulary, sourceLabel("root config", effectiveConfig.rootConfigPath));
  setRecordSources(sources, effectiveConfig.packageConfig?.vocabulary, sourceLabel("package config", effectiveConfig.packageConfigPath));
  return sources;
}

function setRecordSources(
  sources: Map<string, string>,
  record: Record<string, unknown> | undefined,
  source: string,
): void {
  for (const key of Object.keys(record ?? {})) {
    sources.set(key, source);
  }
}

function formatPackSource(effectiveConfig: EffectiveConfig, cliSources: DoctorCliSources): string {
  if (cliSources.pack) return "CLI --pack";
  return formatLayeredSource(configFieldSources(effectiveConfig, "pack"), "(none)");
}

function formatRulesSource(
  effectiveConfig: EffectiveConfig,
  cliSources: DoctorCliSources,
  packIds: string[],
): string {
  if (cliSources.rules) return "CLI --rules";
  const configSources = configFieldSources(effectiveConfig, "rules");
  if (configSources.length) return formatLayeredSource(configSources);
  if (packIds.length) return packIds.map((packId) => `pack "${packId}" defaults`).join(" + ");
  return "built-in detector registry";
}

function formatIncludeSource(
  effectiveConfig: EffectiveConfig,
  cliSources: DoctorCliSources,
  include: string[],
  packIds: string[],
): string {
  if (cliSources.include) return "CLI --include";
  const sources = configFieldSources(effectiveConfig, "include");
  const base = formatLayeredSource(sources.length ? sources : ["defaults"]);
  return packIds.includes("python") && include.includes("**/*.py")
    ? `${base} + python pack discovery`
    : base;
}

function formatScalarSource(
  effectiveConfig: EffectiveConfig,
  fromCli: boolean | undefined,
  field: keyof DebtLensConfig,
  cliLabel: string,
  defaultLabel: string,
): string {
  if (fromCli) return cliLabel;
  return formatLayeredSource(configFieldSources(effectiveConfig, field), defaultLabel);
}

function configFieldSources(effectiveConfig: EffectiveConfig, field: keyof DebtLensConfig): string[] {
  return [
    effectiveConfig.rootConfig && effectiveConfig.rootConfig[field] !== undefined
      ? sourceLabel("root config", effectiveConfig.rootConfigPath)
      : undefined,
    effectiveConfig.packageConfig && effectiveConfig.packageConfig[field] !== undefined
      ? sourceLabel("package config", effectiveConfig.packageConfigPath)
      : undefined,
  ].filter((entry): entry is string => entry !== undefined);
}

function sourceLabel(label: string, path: string | undefined): string {
  return path ? `${label} (${path})` : label;
}

function formatLayeredSource(sources: string[], fallback = "defaults"): string {
  return sources.length ? sources.join(" + ") : fallback;
}

function formatVocabularyLines(
  vocabulary: ScanOptions["vocabulary"],
  sources: Map<string, string>,
): string[] {
  const keys = Object.keys(vocabulary ?? {}).sort((left, right) => left.localeCompare(right));
  if (!keys.length) return ["  (none)"];
  return keys.map((key) => `  ${key}: ${sources.get(key) ?? "unknown"}`);
}
