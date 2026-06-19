import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findConfigPath, findLocalConfigPath, loadEffectiveConfig, type EffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { validateConfigShape } from "../config/validateConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { allDetectors, detectorIds } from "../detectors/index.js";
import { resolveFilePaths } from "../core/resolveFiles.js";
import { defaultConfig } from "../config/defaults.js";
import { getRulePack } from "../config/packs.js";
import { loadPlugins, pluginsDisabled } from "../plugins/loadPlugins.js";
import type { CliOptions, DebtLensConfig, Detector, ScanOptions, ScanThresholds } from "../core/types.js";
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
  detectors: Detector[];
  ruleIds: string[];
  modulePaths: DoctorPluginModulePath[];
  ruleSources: Map<string, string>;
  thresholds?: ScanThresholds;
  thresholdSources: Map<string, string>;
  vocabulary?: Record<string, string[]>;
  vocabularySources: Map<string, string>;
  warnings: string[];
}

interface DoctorPluginModulePath {
  configuredPath: string;
  resolvedPath: string;
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
  const pluginContribution = configValidation.state !== "invalid"
    ? await loadPluginContributionForDoctor(effectiveConfig, fileConfig)
    : emptyPluginContribution();
  const options = mergeConfig(target, fileConfig, {
    ...input.cliOptions,
    ...(pluginContribution.detectors.length ? { pluginDetectors: pluginContribution.detectors } : {}),
    ...(pluginContribution.thresholds ? { pluginThresholds: pluginContribution.thresholds } : {}),
    ...(pluginContribution.vocabulary ? { pluginVocabulary: pluginContribution.vocabulary } : {}),
  });
  const filePaths = await resolveFilePaths(options);
  const resolvedRules = resolveRuleIds(options, pluginContribution);
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
  if (!fileConfig.plugins?.length) return emptyPluginContribution();
  const modulePaths = resolvePluginModulePaths(effectiveConfig.pluginConfigDir, fileConfig.plugins);
  const loaded = await loadPlugins(effectiveConfig.pluginConfigDir, fileConfig, new Set(detectorIds));
  const metadata = pluginsDisabled()
    ? emptyPluginMetadata()
    : await loadPluginMetadataForDoctor(modulePaths);
  return {
    detectors: loaded.detectors,
    ruleIds: loaded.detectors.map((detector) => detector.id),
    modulePaths,
    ruleSources: metadata.ruleSources,
    thresholds: Object.keys(loaded.thresholds).length ? loaded.thresholds : undefined,
    thresholdSources: metadata.thresholdSources,
    vocabulary: Object.keys(loaded.vocabulary).length ? loaded.vocabulary : undefined,
    vocabularySources: metadata.vocabularySources,
    warnings: loaded.warnings,
  };
}

function emptyPluginContribution(): DoctorPluginContribution {
  return {
    detectors: [],
    ruleIds: [],
    modulePaths: [],
    ruleSources: new Map(),
    thresholdSources: new Map(),
    vocabularySources: new Map(),
    warnings: [],
  };
}

function resolvePluginModulePaths(configDir: string, plugins: string[]): DoctorPluginModulePath[] {
  return plugins.map((pluginPath) => ({
    configuredPath: pluginPath,
    resolvedPath: resolve(configDir, pluginPath),
  }));
}

interface DoctorPluginMetadata {
  ruleSources: Map<string, string>;
  thresholdSources: Map<string, string>;
  vocabularySources: Map<string, string>;
}

function emptyPluginMetadata(): DoctorPluginMetadata {
  return {
    ruleSources: new Map(),
    thresholdSources: new Map(),
    vocabularySources: new Map(),
  };
}

async function loadPluginMetadataForDoctor(modulePaths: DoctorPluginModulePath[]): Promise<DoctorPluginMetadata> {
  const metadata = emptyPluginMetadata();

  for (const modulePath of modulePaths) {
    const moduleExports = await import(pathToFileURL(modulePath.resolvedPath).href) as { default?: unknown };
    const inspected = inspectPluginExportForDoctor(moduleExports.default);
    const ruleSource = formatPluginRuleSource(modulePath.resolvedPath);
    const defaultsSource = formatPluginDefaultsSource([modulePath]);

    for (const ruleId of inspected.ruleIds) {
      metadata.ruleSources.set(ruleId, ruleSource);
    }
    for (const thresholdKey of inspected.thresholdKeys) {
      metadata.thresholdSources.set(thresholdKey, defaultsSource);
    }
    for (const vocabularyKey of inspected.vocabularyKeys) {
      metadata.vocabularySources.set(vocabularyKey, defaultsSource);
    }
  }

  return metadata;
}

function inspectPluginExportForDoctor(exported: unknown): {
  ruleIds: string[];
  thresholdKeys: string[];
  vocabularyKeys: string[];
} {
  if (!isRecord(exported)) {
    return { ruleIds: [], thresholdKeys: [], vocabularyKeys: [] };
  }

  const rules = Array.isArray(exported.rules) ? exported.rules : [exported];
  const ruleIds = rules
    .map((rule) => isRecord(rule) && typeof rule.id === "string" ? rule.id : undefined)
    .filter((ruleId): ruleId is string => ruleId !== undefined);
  const thresholdKeys = isRecord(exported.thresholds) ? Object.keys(exported.thresholds) : [];
  const vocabularyKeys = isRecord(exported.vocabulary) ? Object.keys(exported.vocabulary) : [];

  return { ruleIds, thresholdKeys, vocabularyKeys };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function resolveRuleIds(options: ScanOptions, pluginContribution: DoctorPluginContribution): string[] {
  if (options.rules?.length) {
    return options.rules;
  }

  return [
    ...allDetectors.map((detector) => detector.id),
    ...pluginContribution.ruleIds,
  ];
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
  const thresholdSources = buildThresholdSources(input.effectiveConfig, packIds, input.pluginContribution, input.cliOptions.thresholds);
  const vocabularySources = buildVocabularySources(input.effectiveConfig, input.pluginContribution);
  const lines = [
    "Provenance",
    "----------",
    `Pack: ${formatPackSource(input.effectiveConfig, input.cliSources)}`,
    `Rules: ${formatRulesSource(input.effectiveConfig, input.cliSources, packIds, input.pluginContribution)}`,
    `Include globs: ${formatIncludeSource(input.effectiveConfig, input.cliSources, input.options.include, packIds)}`,
    `Exclude globs: ${formatLayeredSource([
      "defaults",
      ...configFieldSources(input.effectiveConfig, "exclude"),
      ...(input.cliSources.exclude ? ["CLI --exclude"] : []),
    ])}`,
    `Min severity: ${formatScalarSource(input.effectiveConfig, input.cliSources.minSeverity, "minSeverity", "CLI --min-severity", "defaults")}`,
    `Max files: ${formatScalarSource(input.effectiveConfig, input.cliSources.maxFiles, "maxFiles", "CLI --max-files", "defaults")}`,
    `Respect gitignore: ${formatScalarSource(input.effectiveConfig, input.cliSources.respectGitignore, "respectGitignore", "CLI --respect-gitignore", "defaults")}`,
    `Plugins: ${formatEffectiveConfigSource(input.effectiveConfig, "plugins", "(none)")}`,
    ...formatPluginModuleLines(input.pluginContribution.modulePaths),
    ...formatPluginRuleLines(input.pluginContribution),
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
  pluginContribution: DoctorPluginContribution,
  cliThresholds: ScanThresholds | undefined,
): Map<string, string> {
  const sources = new Map<string, string>();
  setRecordSources(sources, defaultConfig.thresholds, "defaults");
  for (const packId of packIds) {
    setRecordSources(sources, getRulePack(packId).thresholds, `pack "${packId}" defaults`);
  }
  setPluginRecordSources(
    sources,
    pluginContribution.thresholds,
    pluginContribution.thresholdSources,
    formatPluginDefaultsSource(pluginContribution.modulePaths),
  );
  setRecordSources(sources, effectiveConfig.rootConfig?.thresholds, sourceLabel("root config", effectiveConfig.rootConfigPath));
  setRecordSources(sources, effectiveConfig.packageConfig?.thresholds, sourceLabel("package config", effectiveConfig.packageConfigPath));
  setRecordSources(sources, cliThresholds, "CLI --threshold");
  return sources;
}

function buildVocabularySources(
  effectiveConfig: EffectiveConfig,
  pluginContribution: DoctorPluginContribution,
): Map<string, string> {
  const sources = new Map<string, string>();
  setRecordSources(sources, defaultConfig.vocabulary, "defaults");
  setPluginRecordSources(
    sources,
    pluginContribution.vocabulary,
    pluginContribution.vocabularySources,
    formatPluginDefaultsSource(pluginContribution.modulePaths),
  );
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

function setPluginRecordSources(
  sources: Map<string, string>,
  record: Record<string, unknown> | undefined,
  pluginSources: Map<string, string>,
  fallback: string,
): void {
  for (const key of Object.keys(record ?? {})) {
    sources.set(key, pluginSources.get(key) ?? fallback);
  }
}

function formatPackSource(effectiveConfig: EffectiveConfig, cliSources: DoctorCliSources): string {
  if (cliSources.pack) return "CLI --pack";
  return formatEffectiveConfigSource(effectiveConfig, "pack", "(none)");
}

function formatRulesSource(
  effectiveConfig: EffectiveConfig,
  cliSources: DoctorCliSources,
  packIds: string[],
  pluginContribution: DoctorPluginContribution,
): string {
  if (cliSources.rules) return "CLI --rules";
  const configSources = configFieldSources(effectiveConfig, "rules");
  if (configSources.length) return formatLayeredSource(configSources);
  const pluginRuleSource = pluginContribution.ruleIds.length
    ? formatPluginRuleSource(formatPluginModulePaths(pluginContribution.modulePaths))
    : undefined;
  if (packIds.length) {
    return formatLayeredSource([
      packIds.map((packId) => `pack "${packId}" defaults`).join(" + "),
      pluginRuleSource,
    ].filter((source): source is string => source !== undefined));
  }
  return formatLayeredSource([
    "built-in detector registry",
    pluginRuleSource,
  ].filter((source): source is string => source !== undefined));
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
  const discovery = [
    ...(packIds.includes("python") && include.includes("**/*.py") ? ["python"] : []),
    ...(packIds.includes("kotlin") && include.includes("**/*.{kt,kts}") ? ["kotlin"] : []),
  ];
  return discovery.length ? `${base} + ${discovery.join(" + ")} pack discovery` : base;
}

function formatScalarSource(
  effectiveConfig: EffectiveConfig,
  fromCli: boolean | undefined,
  field: keyof DebtLensConfig,
  cliLabel: string,
  defaultLabel: string,
): string {
  if (fromCli) return cliLabel;
  return formatEffectiveConfigSource(effectiveConfig, field, defaultLabel);
}

function formatEffectiveConfigSource(
  effectiveConfig: EffectiveConfig,
  field: keyof DebtLensConfig,
  fallback: string,
): string {
  if (hasConfigField(effectiveConfig.packageConfig, field)) {
    return sourceLabel("package config", effectiveConfig.packageConfigPath);
  }
  if (hasConfigField(effectiveConfig.rootConfig, field)) {
    return sourceLabel("root config", effectiveConfig.rootConfigPath);
  }
  return fallback;
}

function configFieldSources(effectiveConfig: EffectiveConfig, field: keyof DebtLensConfig): string[] {
  return [
    hasConfigField(effectiveConfig.rootConfig, field)
      ? sourceLabel("root config", effectiveConfig.rootConfigPath)
      : undefined,
    hasConfigField(effectiveConfig.packageConfig, field)
      ? sourceLabel("package config", effectiveConfig.packageConfigPath)
      : undefined,
  ].filter((entry): entry is string => entry !== undefined);
}

function hasConfigField(config: DebtLensConfig | undefined, field: keyof DebtLensConfig): boolean {
  return config !== undefined
    && Object.prototype.hasOwnProperty.call(config, field)
    && config[field] !== undefined;
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

function formatPluginModuleLines(modulePaths: DoctorPluginModulePath[]): string[] {
  if (!modulePaths.length) return [];
  return [
    "Policy/plugin modules:",
    ...modulePaths.map((modulePath) => `  ${modulePath.configuredPath}: ${modulePath.resolvedPath}`),
  ];
}

function formatPluginRuleLines(pluginContribution: DoctorPluginContribution): string[] {
  if (!pluginContribution.modulePaths.length) return [];
  if (!pluginContribution.ruleIds.length) return ["Policy/plugin rules: (none)"];

  return [
    "Policy/plugin rules:",
    ...pluginContribution.ruleIds.map((ruleId) =>
      `  ${ruleId}: ${pluginContribution.ruleSources.get(ruleId) ?? formatPluginRuleSource(formatPluginModulePaths(pluginContribution.modulePaths))}`),
  ];
}

function formatPluginRuleSource(modulePath: string): string {
  return `policy/plugin module (${modulePath})`;
}

function formatPluginDefaultsSource(modulePaths: DoctorPluginModulePath[]): string {
  if (modulePaths.length === 1) {
    return `policy/plugin module defaults (${modulePaths[0].resolvedPath})`;
  }
  if (modulePaths.length > 1) {
    return `policy/plugin module defaults (${formatPluginModulePaths(modulePaths)})`;
  }
  return "plugin defaults";
}

function formatPluginModulePaths(modulePaths: DoctorPluginModulePath[]): string {
  return modulePaths.map((modulePath) => modulePath.resolvedPath).join(" + ");
}
