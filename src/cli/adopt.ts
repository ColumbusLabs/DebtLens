import { loadConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import { DEFAULT_BASELINE_FILENAME, createBaseline, writeBaseline } from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { severities } from "../core/severity.js";
import type { CliOptions, ScanResult, Severity } from "../core/types.js";
import { buildThresholdSuggestions, type ThresholdSuggestion } from "./adoptionThresholds.js";
import { runInit } from "./init.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export interface AdoptInput {
  target: string;
  cwd: string;
  configPath?: string;
  cliOptions: CliOptions;
  writeConfig?: boolean;
  force?: boolean;
  pack?: string;
  packageName?: string;
  writeBaseline?: boolean | string;
  format?: "terminal" | "markdown";
}

export interface AdoptResult {
  text: string;
  scan: ScanResult;
  thresholdSuggestions: ThresholdSuggestion[];
  configWritten?: string;
  baselineWritten?: string;
  baselineSkipped?: boolean;
}

export function recommendMinSeverity(bySeverity: Record<Severity, number>, total: number): Severity {
  if (total === 0) return "low";

  const lowNoise = bySeverity.info + bySeverity.low;
  if (total >= 10 && lowNoise / total >= 0.7) return "medium";
  if (total >= 20 && lowNoise / total >= 0.5) return "medium";

  return "low";
}

export function formatAdoptReport(
  scanResult: ScanResult,
  recommendedMinSeverity: Severity,
  thresholdSuggestions: ThresholdSuggestion[] = [],
): string {
  const { summary } = scanResult;
  const topRules = Object.entries(summary.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const lines = [
    "DebtLens Adoption Report",
    "========================",
    `Files scanned: ${summary.filesScanned}`,
    `Total issues: ${summary.totalIssues}`,
    "",
    "By severity:",
    ...severities.map((severity) => `  ${severity}: ${summary.bySeverity[severity]}`),
    "",
    "Top rules:",
    ...(topRules.length > 0
      ? topRules.map(([rule, count]) => `  ${rule}: ${count}`)
      : ["  (none)"]),
    "",
    `Recommended minSeverity: ${recommendedMinSeverity}`,
  ];
  if (thresholdSuggestions.length > 0) {
    lines.push("", "Suggested threshold tuning:");
    for (const suggestion of thresholdSuggestions) {
      lines.push(`  ${suggestion.key}: ${suggestion.current} -> ${suggestion.suggested} (p90 observed ${suggestion.observedP90}, ${suggestion.samples} sample${suggestion.samples === 1 ? "" : "s"})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatAdoptMarkdownReport(
  scanResult: ScanResult,
  recommendedMinSeverity: Severity,
  thresholdSuggestions: ThresholdSuggestion[] = [],
): string {
  const { summary } = scanResult;
  const topRules = Object.entries(summary.byRule)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = [
    "# DebtLens Adoption Report",
    "",
    `Scanned **${summary.filesScanned}** files and found **${summary.totalIssues}** issues.`,
    "",
    "## Severity Histogram",
    "",
    "| Severity | Issues |",
    "| --- | ---: |",
    ...severities.map((severity) => `| ${severity} | ${summary.bySeverity[severity]} |`),
    "",
    "## Top Rules",
    "",
    "| Rule | Issues |",
    "| --- | ---: |",
    ...(topRules.length > 0
      ? topRules.map(([rule, count]) => `| \`${rule}\` | ${count} |`)
      : ["| None | 0 |"]),
    "",
    `Recommended minSeverity: **${recommendedMinSeverity}**`,
  ];
  if (thresholdSuggestions.length > 0) {
    lines.push(
      "",
      "## Suggested Threshold Tuning",
      "",
      "| Threshold | Current | Suggested | P90 observed | Samples |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...thresholdSuggestions.map((suggestion) => `| \`${suggestion.key}\` | ${suggestion.current} | ${suggestion.suggested} | ${suggestion.observedP90} | ${suggestion.samples} |`),
    );
  }

  return `${lines.join("\n")}\n`;
}

export async function runAdopt(input: AdoptInput): Promise<AdoptResult> {
  const fileConfig = loadConfig(input.cwd, input.configPath);
  const target = input.packageName
    ? resolveWorkspacePackage(input.cwd, input.packageName).directory
    : input.target;
  const options = mergeConfig(target, fileConfig, input.cliOptions);
  const result = await scan(options);

  const recommended = recommendMinSeverity(result.summary.bySeverity, result.summary.totalIssues);
  const thresholdSuggestions = buildThresholdSuggestions(result, options);
  const lines: string[] = [];

  if (result.summary.filesScanned === 0) {
    lines.push(buildZeroFilesScannedWarning(options.target, options.include, false).trimEnd());
    lines.push("");
  }

  if (result.summary.warnings?.length) {
    for (const warning of result.summary.warnings) {
      lines.push(`DebtLens warning: ${warning}`);
    }
    lines.push("");
  }

  lines.push((input.format === "markdown"
    ? formatAdoptMarkdownReport(result, recommended, thresholdSuggestions)
    : formatAdoptReport(result, recommended, thresholdSuggestions)).trimEnd());

  let configWritten: string | undefined;
  let baselineWritten: string | undefined;
  let baselineSkipped = false;

  if (input.writeConfig) {
    const initResult = runInit(input.cwd, input.force === true, input.pack, thresholdSuggestionOverrides(thresholdSuggestions));
    configWritten = initResult.path;
    lines.push("");
    lines.push(`${initResult.overwritten ? "Overwrote" : "Created"} ${initResult.path}`);
  }

  if (input.writeBaseline !== undefined && input.writeBaseline !== false) {
    if (result.issues.length === 0) {
      baselineSkipped = true;
      lines.push("");
      lines.push("Skipped baseline write (0 issues found).");
    } else {
      const baselinePath = input.writeBaseline === true
        ? DEFAULT_BASELINE_FILENAME
        : String(input.writeBaseline);
      baselineWritten = writeBaseline(input.cwd, baselinePath, createBaseline(result.issues));
      lines.push("");
      lines.push(`Wrote baseline with ${result.issues.length} issues to ${baselineWritten}`);
    }
  }

  const dryRun = !input.writeConfig && input.writeBaseline === undefined;
  if (dryRun) {
    lines.push("");
    lines.push("Dry run — no files written. Use --write-config --force and/or --write-baseline to apply.");
  }

  return {
    text: `${lines.join("\n")}\n`,
    scan: result,
    thresholdSuggestions,
    configWritten,
    baselineWritten,
    baselineSkipped,
  };
}

function thresholdSuggestionOverrides(suggestions: ThresholdSuggestion[]): Record<string, number> {
  return Object.fromEntries(suggestions.map((suggestion) => [suggestion.key, suggestion.suggested]));
}
