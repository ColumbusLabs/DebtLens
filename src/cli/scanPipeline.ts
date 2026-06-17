import { dirname, resolve } from "node:path";
import { findConfigPath } from "../config/loadConfig.js";
import { applyBaseline, createBaseline, loadBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { getLineIntroducedDaysAgo, getRefSnapshot } from "../utils/git.js";
import { parseSeverity, severityRank } from "../core/severity.js";
import type { DebtIssue, DebtLensConfig, Detector, ScanOptions, ScanResult, ScanThresholds, Severity } from "../core/types.js";
import { detectorIds } from "../detectors/index.js";
import { loadPlugins } from "../plugins/loadPlugins.js";
import { parseConfidence } from "./parse.js";

export interface PluginContribution {
  detectors?: Detector[];
  thresholds?: ScanThresholds;
  vocabulary?: Record<string, string[]>;
}

export async function loadConfiguredPlugins(
  cwd: string,
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
  configDirOverride?: string,
): Promise<PluginContribution | undefined> {
  if (!fileConfig.plugins?.length) return undefined;

  const configPath = findConfigPath(cwd, rawOptions.config ? String(rawOptions.config) : undefined);
  const configDir = configDirOverride ?? (configPath ? dirname(configPath) : cwd);
  const loaded = await loadPlugins(configDir, fileConfig, new Set(detectorIds));
  for (const warning of loaded.warnings) {
    process.stderr.write(`DebtLens: ${warning}\n`);
  }
  return {
    detectors: loaded.detectors.length > 0 ? loaded.detectors : undefined,
    thresholds: Object.keys(loaded.thresholds).length > 0 ? loaded.thresholds : undefined,
    vocabulary: Object.keys(loaded.vocabulary).length > 0 ? loaded.vocabulary : undefined,
  };
}

export function resolveFailOn(
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): Severity | undefined {
  if (rawOptions.failOn) {
    return parseSeverity(String(rawOptions.failOn), "high");
  }
  if (fileConfig.failOn !== undefined) {
    return parseSeverity(String(fileConfig.failOn), "high");
  }
  return undefined;
}

export function resolveFailOnConfidence(
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): number | undefined {
  if (rawOptions.failOnConfidence !== undefined) {
    return parseConfidence(String(rawOptions.failOnConfidence));
  }
  return fileConfig.failOnConfidence;
}

export function shouldFailOnIssue(issue: DebtIssue, failOn: Severity, failOnConfidence: number | undefined): boolean {
  if (severityRank[issue.severity] < severityRank[failOn]) return false;
  if (failOnConfidence === undefined) return true;
  return issue.confidence >= failOnConfidence;
}

export function shouldFailOnRegression(result: ScanResult): boolean {
  const delta = result.summary.deltaFromBaseline;
  if (!delta) return false;
  if (delta.totalDelta > 0) return true;
  if (delta.severityRegressions > 0) return true;
  if (!delta.hasBaselineSummary) return false;
  return Object.values(delta.byRule).some((ruleDelta) => ruleDelta.delta > 0);
}

export function enrichIssuesWithBlameAge(cwd: string, options: ScanOptions, result: ScanResult): void {
  if (options.fileContents) {
    process.stderr.write("DebtLens: --blame-age ignored when scanning staged blob contents.\n");
    return;
  }

  let warnedNotGit = false;
  for (const issue of result.issues) {
    const line = issue.location?.startLine;
    if (line === undefined) continue;
    const issuePath = resolve(options.target, issue.file);
    const introducedDaysAgo = getLineIntroducedDaysAgo(cwd, issuePath, line);
    if (introducedDaysAgo === null) {
      if (!warnedNotGit) {
        process.stderr.write("DebtLens: --blame-age ignored (not a git repository).\n");
        warnedNotGit = true;
      }
      break;
    }
    if (introducedDaysAgo !== undefined) {
      issue.introducedDaysAgo = introducedDaysAgo;
    }
  }
}

export async function resolveReportedIssues(
  result: ScanResult,
  context: {
    cwd: string;
    baselinePath?: string;
    diffBase?: string;
    scanOptions: ScanOptions;
  },
): Promise<ScanResult> {
  if (context.baselinePath) {
    return applyBaseline(result, loadBaseline(context.cwd, context.baselinePath));
  }

  if (!context.diffBase) return result;

  const snapshot = getRefSnapshot(context.cwd, context.diffBase);
  if (!snapshot) {
    process.stderr.write("DebtLens: --diff-base ignored (not a git repository).\n");
    return result;
  }

  const packageTarget = resolve(context.cwd, context.scanOptions.target);
  const packagePrefix = `${packageTarget.replace(/[/\\]+$/, "")}/`;
  const scopedToPackage = packageTarget !== snapshot.root;
  const scopedFiles = scopedToPackage
    ? snapshot.files.filter((file) => file === packageTarget || file.startsWith(packagePrefix))
    : snapshot.files;
  const scopedContents = snapshot.contents
    ? Object.fromEntries(
      Object.entries(snapshot.contents).filter(([file]) => scopedFiles.includes(file)),
    )
    : undefined;

  const baseResult = await scan({
    ...context.scanOptions,
    cwd: context.cwd,
    target: scopedToPackage ? context.scanOptions.target : snapshot.root,
    changedFiles: scopedFiles,
    fileContents: scopedContents,
  });
  return applyBaseline(result, createBaseline(baseResult.issues));
}
