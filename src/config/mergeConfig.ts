import { resolve } from "node:path";
import { defaultConfig } from "./defaults.js";
import type { CliOptions, DebtLensConfig, ScanOptions } from "../core/types.js";

export function mergeConfig(target: string, fileConfig: DebtLensConfig, cliOptions: CliOptions): ScanOptions {
  const cwd = resolve(cliOptions.cwd ?? process.cwd());

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
    rules: cliOptions.rules?.length ? cliOptions.rules : fileConfig.rules,
    thresholds: {
      ...defaultConfig.thresholds,
      ...(fileConfig.thresholds ?? {}),
      ...(cliOptions.thresholds ?? {}),
    },
    maxFiles: cliOptions.maxFiles ?? fileConfig.maxFiles ?? defaultConfig.maxFiles,
    vocabulary: { ...defaultConfig.vocabulary, ...(fileConfig.vocabulary ?? {}) },
    propDrillingIgnoreComponents: [
      ...(defaultConfig.propDrilling?.ignoreComponents ?? []),
      ...(fileConfig.propDrilling?.ignoreComponents ?? []),
    ],
    changedFiles: cliOptions.changedFiles,
  };
}
