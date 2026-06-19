import { resolve } from "node:path";
import { defaultConfig } from "./defaults.js";
import { getRulePack } from "./packs.js";
import { compileTodoCommentMarkers } from "../detectors/todoComment.js";
import { isSeverity, severities } from "../core/severity.js";
import type { CliOptions, DebtLensConfig, ScanOptions, Severity } from "../core/types.js";

export function mergeConfig(target: string, fileConfig: DebtLensConfig, cliOptions: CliOptions): ScanOptions {
  const cwd = resolve(cliOptions.cwd ?? process.cwd());
  const packIds = parsePackIds(cliOptions.pack ?? fileConfig.pack);
  const packs = packIds.map((packId) => getRulePack(packId));

  const explicitRules = cliOptions.rules?.length ? cliOptions.rules : fileConfig.rules;
  const pluginRuleIds = cliOptions.pluginDetectors?.map((detector) => detector.id) ?? [];
  const rules = explicitRules?.length
    ? explicitRules
    : packs.length
      ? unique([...packs.flatMap((pack) => pack.rules), ...pluginRuleIds])
      : undefined;
  const languageDiscovery = resolveLanguageDiscovery(packIds, rules);

  return {
    cwd,
    target: resolve(cwd, target),
    include: resolveIncludeGlobs(fileConfig, cliOptions, languageDiscovery),
    exclude: [
      ...resolveDefaultExcludes(languageDiscovery),
      ...(fileConfig.exclude ?? []),
      ...(cliOptions.exclude ?? []),
    ],
    minSeverity: cliOptions.minSeverity ?? fileConfig.minSeverity ?? defaultConfig.minSeverity,
    pack: packIds.length ? packIds.join(",") : undefined,
    rules,
    thresholds: {
      ...defaultConfig.thresholds,
      ...Object.assign({}, ...packs.map((pack) => pack.thresholds ?? {})),
      ...(cliOptions.pluginThresholds ?? {}),
      ...(fileConfig.thresholds ?? {}),
      ...(cliOptions.thresholds ?? {}),
    },
    maxFiles: cliOptions.maxFiles ?? fileConfig.maxFiles ?? defaultConfig.maxFiles,
    respectGitignore: cliOptions.respectGitignore ?? fileConfig.respectGitignore ?? defaultConfig.respectGitignore,
    vocabulary: {
      ...defaultConfig.vocabulary,
      ...(cliOptions.pluginVocabulary ?? {}),
      ...(fileConfig.vocabulary ?? {}),
    },
    namingDriftDisableBuiltInVocabulary:
      fileConfig.namingDrift?.disableBuiltInVocabulary ?? defaultConfig.namingDrift.disableBuiltInVocabulary,
    propDrillingIgnoreComponents: [
      ...(defaultConfig.propDrilling?.ignoreComponents ?? []),
      ...(fileConfig.propDrilling?.ignoreComponents ?? []),
    ],
    todoCommentReplaceDefaults: fileConfig.todoComment?.replaceDefaults ?? defaultConfig.todoComment.replaceDefaults,
    todoCommentDisableDefaults: fileConfig.todoComment?.disableDefaults ?? defaultConfig.todoComment.disableDefaults,
    todoCommentMarkers: fileConfig.todoComment?.markers?.length
      ? compileTodoCommentMarkers(fileConfig.todoComment.markers)
      : undefined,
    changedFiles: cliOptions.changedFiles,
    fileContents: cliOptions.fileContents,
    profile: cliOptions.profile,
    auditSuppressions: cliOptions.auditSuppressions,
    cache: cliOptions.cache,
    cachePath: cliOptions.cachePath,
    batchSize: cliOptions.batchSize,
    parallel: cliOptions.parallel,
    pluginDetectors: cliOptions.pluginDetectors,
    ruleSeverities: validateRuleSeverities(fileConfig.ruleSeverities),
    ruleConfidenceFloors: validateRuleConfidenceFloors(fileConfig.ruleConfidenceFloors),
  };
}

function parsePackIds(pack: string | undefined): string[] {
  if (!pack) return [];
  return unique(pack.split(",").map((packId) => packId.trim()).filter(Boolean));
}

function resolveIncludeGlobs(
  fileConfig: DebtLensConfig,
  cliOptions: CliOptions,
  languageDiscovery: LanguageDiscovery,
): string[] {
  if (cliOptions.include?.length) return cliOptions.include;
  const base = resolveBaseIncludeGlobs(fileConfig, languageDiscovery);
  return unique([
    ...base,
    ...(languageDiscovery.python ? ["**/*.py"] : []),
    ...(languageDiscovery.kotlin ? ["**/*.{kt,kts}"] : []),
  ]);
}

interface LanguageDiscovery {
  tsjs: boolean;
  python: boolean;
  kotlin: boolean;
}

function resolveLanguageDiscovery(packIds: string[], rules: string[] | undefined): LanguageDiscovery {
  const hasTsjsPack = packIds.some((packId) => packId !== "python" && packId !== "kotlin" && packId !== "compose");
  const hasTsjsRule = rules?.some((ruleId) => !isLanguageSpecificRule(ruleId)) === true;
  return {
    tsjs: packIds.length > 0 ? hasTsjsPack : rules?.length ? hasTsjsRule : true,
    python: packIds.includes("python") || rules?.some((ruleId) => ruleId.startsWith("python-")) === true,
    kotlin: packIds.some((packId) => packId === "kotlin" || packId === "compose")
      || rules?.some((ruleId) => ruleId.startsWith("kotlin-") || ruleId.startsWith("compose-")) === true,
  };
}

function isLanguageSpecificRule(ruleId: string): boolean {
  return ruleId.startsWith("python-") || ruleId.startsWith("kotlin-") || ruleId.startsWith("compose-");
}

function resolveBaseIncludeGlobs(
  fileConfig: DebtLensConfig,
  languageDiscovery: LanguageDiscovery,
): string[] {
  if (fileConfig.include) return fileConfig.include;
  return languageDiscovery.tsjs ? defaultConfig.include : [];
}

function resolveDefaultExcludes(languageDiscovery: LanguageDiscovery): string[] {
  return languageDiscovery.kotlin
    ? defaultConfig.exclude.flatMap((pattern) => pattern === "android/**" ? ["android/**/*.{ts,tsx,js,jsx}"] : [pattern])
    : defaultConfig.exclude;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function validateRuleSeverities(ruleSeverities: DebtLensConfig["ruleSeverities"]): Record<string, Severity> | undefined {
  if (!ruleSeverities) return undefined;
  for (const [ruleId, severity] of Object.entries(ruleSeverities)) {
    if (!isSeverity(severity)) {
      throw new Error(
        `Config "ruleSeverities.${ruleId}" must be one of ${severities.join(", ")}; received "${String(severity)}".`,
      );
    }
  }
  return ruleSeverities;
}

function validateRuleConfidenceFloors(
  ruleConfidenceFloors: DebtLensConfig["ruleConfidenceFloors"],
): Record<string, number> | undefined {
  if (!ruleConfidenceFloors) return undefined;
  for (const [ruleId, floor] of Object.entries(ruleConfidenceFloors)) {
    if (typeof floor !== "number" || !Number.isFinite(floor) || floor < 0 || floor > 1) {
      throw new Error(
        `Config "ruleConfidenceFloors.${ruleId}" must be a number between 0 and 1; received "${String(floor)}".`,
      );
    }
  }
  return ruleConfidenceFloors;
}
