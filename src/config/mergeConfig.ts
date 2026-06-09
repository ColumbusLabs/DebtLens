import { resolve } from "node:path";
import { defaultConfig } from "./defaults.js";
import { getRulePack } from "./packs.js";
import { compileTodoCommentMarkers } from "../detectors/todoComment.js";
import type { CliOptions, DebtLensConfig, ScanOptions } from "../core/types.js";

export function mergeConfig(target: string, fileConfig: DebtLensConfig, cliOptions: CliOptions): ScanOptions {
  const cwd = resolve(cliOptions.cwd ?? process.cwd());
  const packId = cliOptions.pack ?? fileConfig.pack;
  if (packId) {
    getRulePack(packId);
  }

  const explicitRules = cliOptions.rules?.length ? cliOptions.rules : fileConfig.rules;
  const rules = explicitRules?.length
    ? explicitRules
    : packId
      ? [...getRulePack(packId).rules]
      : undefined;

  return {
    cwd,
    target: resolve(cwd, target),
    include: cliOptions.include?.length ? cliOptions.include : fileConfig.include ?? defaultConfig.include,
    exclude: [
      ...defaultConfig.exclude,
      ...(fileConfig.exclude ?? []),
      ...(cliOptions.exclude ?? []),
    ],
    minSeverity: cliOptions.minSeverity ?? fileConfig.minSeverity ?? defaultConfig.minSeverity,
    pack: packId,
    rules,
    thresholds: {
      ...defaultConfig.thresholds,
      ...(fileConfig.thresholds ?? {}),
      ...(cliOptions.thresholds ?? {}),
    },
    maxFiles: cliOptions.maxFiles ?? fileConfig.maxFiles ?? defaultConfig.maxFiles,
    respectGitignore: cliOptions.respectGitignore ?? fileConfig.respectGitignore ?? defaultConfig.respectGitignore,
    vocabulary: { ...defaultConfig.vocabulary, ...(fileConfig.vocabulary ?? {}) },
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
  };
}
