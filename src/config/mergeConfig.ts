import { resolve } from "node:path";
import { defaultConfig } from "./defaults.js";
import { getRulePack, listRulePacks } from "./packs.js";
import { compileTodoCommentMarkers } from "../detectors/todoComment.js";
import {
  DEFAULT_SOURCE_LANGUAGE,
  includeGlobsForLanguages,
  languagesForDetector,
  rewriteDefaultExcludesForLanguages,
  unique,
} from "../core/languages.js";
import { isSeverity, severities } from "../core/severity.js";
import type { CliOptions, DebtLensConfig, Detector, ScanOptions, Severity, SourceLanguage } from "../core/types.js";

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
  const languageDiscovery = resolveLanguageDiscovery(rules, cliOptions.pluginDetectors);

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
    duplicatedLiteralIgnoreStrings: unique([
      ...(defaultConfig.duplicatedLiteral?.ignoreStrings ?? []),
      ...packs.flatMap((pack) => pack.duplicatedLiteral?.ignoreStrings ?? []),
      ...(fileConfig.duplicatedLiteral?.ignoreStrings ?? []),
    ]),
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
    concurrency: cliOptions.concurrency,
    cacheDir: cliOptions.cacheDir,
    pluginDetectors: cliOptions.pluginDetectors,
    ruleSeverities: validateRuleSeverities(fileConfig.ruleSeverities),
    ruleConfidenceFloors: validateRuleConfidenceFloors(fileConfig.ruleConfidenceFloors),
    budgets: fileConfig.budgets,
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
  const discoveryLanguages = languageDiscovery.languages.filter((language) => language !== DEFAULT_SOURCE_LANGUAGE);
  const packIncludeGlobs = parsePackIds(cliOptions.pack ?? fileConfig.pack)
    .flatMap((packId) => getRulePack(packId).includeGlobs ?? []);
  return unique([
    ...base,
    ...includeGlobsForLanguages(discoveryLanguages),
    ...packIncludeGlobs,
  ]);
}

interface LanguageDiscovery {
  languages: SourceLanguage[];
}

function resolveLanguageDiscovery(rules: string[] | undefined, pluginDetectors: Detector[] | undefined): LanguageDiscovery {
  if (rules?.length) {
    return { languages: languageIdsForRules(rules, pluginDetectors) };
  }

  return {
    languages: unique([
      DEFAULT_SOURCE_LANGUAGE,
      ...(pluginDetectors?.flatMap((detector) => languagesForDetector(detector)) ?? []),
    ]),
  };
}

function languageIdsForRules(ruleIds: string[], pluginDetectors: Detector[] | undefined): SourceLanguage[] {
  const languages = ruleIds.flatMap((ruleId) => {
    const pluginDetector = pluginDetectors?.find((detector) => detector.id === ruleId);
    if (pluginDetector) return languagesForDetector(pluginDetector);

    const owningPack = listRulePacks().find((pack) => pack.rules.includes(ruleId));
    return owningPack?.languages ?? [DEFAULT_SOURCE_LANGUAGE];
  });
  return unique(languages);
}

function resolveBaseIncludeGlobs(
  fileConfig: DebtLensConfig,
  languageDiscovery: LanguageDiscovery,
): string[] {
  if (fileConfig.include) return fileConfig.include;
  return languageDiscovery.languages.includes(DEFAULT_SOURCE_LANGUAGE) ? defaultConfig.include : [];
}

function resolveDefaultExcludes(languageDiscovery: LanguageDiscovery): string[] {
  return rewriteDefaultExcludesForLanguages(languageDiscovery.languages, defaultConfig.exclude);
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
