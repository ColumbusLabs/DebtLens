import { resolve } from "node:path";
import { loadEffectiveConfig } from "../config/loadConfig.js";
import { mergeConfig } from "../config/mergeConfig.js";
import { resolveWorkspacePackage } from "../config/workspaces.js";
import {
  type Baseline,
  type BaselineChangedIssue,
  type BaselineDetailedComparison,
  DEFAULT_BASELINE_FILENAME,
  compareBaselineDetailed,
  loadBaseline,
  pruneBaseline,
  updateBaseline,
  writeBaseline,
} from "../core/baseline.js";
import { scan } from "../core/scan.js";
import { parseSeverity } from "../core/severity.js";
import type { DebtIssue, DebtLensConfig, ScanOptions } from "../core/types.js";
import {
  loadConfiguredPlugins,
} from "./scanPipeline.js";
import {
  parseCommaList,
  parseRuleList,
  parseThresholds,
} from "./parse.js";
import { buildZeroFilesScannedWarning } from "./scanWarnings.js";

export type BaselineMaintenanceMode = "diff" | "prune" | "update";
export type BaselineMaintenanceFormat = "terminal" | "json";

interface BaselineMaintenanceOptions {
  baseline?: unknown;
  batchSize?: unknown;
  cache?: unknown;
  config?: unknown;
  cwd?: unknown;
  dryRun?: unknown;
  exclude?: unknown;
  format?: unknown;
  include?: unknown;
  maxFiles?: unknown;
  minSeverity?: unknown;
  package?: unknown;
  pack?: unknown;
  parallel?: unknown;
  respectGitignore?: unknown;
  rules?: unknown;
  threshold?: unknown;
}

export interface BaselineMaintenanceCommandResult {
  report: string;
  stderr: string;
  exitCode: number;
}

export async function runBaselineMaintenanceCommand(
  mode: BaselineMaintenanceMode,
  target: string,
  rawOptions: BaselineMaintenanceOptions,
): Promise<BaselineMaintenanceCommandResult> {
  const stderrChunks: string[] = [];
  const writeStderr = (text: string) => {
    stderrChunks.push(text);
  };

  const cwd = resolve(String(rawOptions.cwd ?? process.cwd()));
  const baselinePath = rawOptions.baseline ? String(rawOptions.baseline) : DEFAULT_BASELINE_FILENAME;
  const resolvedBaselinePath = resolve(cwd, baselinePath);
  const format = parseBaselineMaintenanceFormat(String(rawOptions.format ?? "terminal"));
  const dryRun = rawOptions.dryRun === true;

  let scanTarget = target;
  let packageDirectory: string | undefined;
  if (rawOptions.package) {
    const workspacePackage = resolveWorkspacePackage(cwd, String(rawOptions.package));
    scanTarget = workspacePackage.directory;
    packageDirectory = workspacePackage.directory;
  }

  const effectiveConfig = loadEffectiveConfig(
    cwd,
    rawOptions.config ? String(rawOptions.config) : undefined,
    packageDirectory,
  );
  const fileConfig = effectiveConfig.config;
  if (mode === "prune" && !dryRun && isScopedPrune(target, cwd, rawOptions, fileConfig)) {
    throw new Error(
      "baseline prune refuses scoped scans because they can delete unrelated baseline entries. " +
      "Run `debtlens baseline diff` first, then prune with the original full baseline scope or use `debtlens baseline update` to intentionally rewrite the baseline.",
    );
  }
  const pluginContribution = await loadConfiguredPlugins(
    cwd,
    rawOptions as Record<string, unknown>,
    fileConfig,
    effectiveConfig.pluginConfigDir,
    writeStderr,
  );
  const minSeverity = parseSeverity(String(rawOptions.minSeverity ?? "low"), "low");
  const scanOptions: ScanOptions = mergeConfig(scanTarget, fileConfig, {
    cwd,
    include: parseCommaList(rawOptions.include as string | undefined),
    exclude: parseCommaList(rawOptions.exclude as string | undefined),
    rules: parseRuleList(rawOptions.rules as string | undefined),
    pack: rawOptions.pack ? String(rawOptions.pack) : undefined,
    thresholds: parseThresholds(rawOptions.threshold as string | undefined),
    minSeverity,
    maxFiles: rawOptions.maxFiles as number | undefined,
    cache: rawOptions.cache !== undefined ? true : undefined,
    cachePath: typeof rawOptions.cache === "string" ? rawOptions.cache : undefined,
    parallel: rawOptions.parallel === true ? true : undefined,
    batchSize: rawOptions.batchSize as number | undefined,
    respectGitignore: rawOptions.respectGitignore === true ? true : undefined,
    pluginDetectors: pluginContribution?.detectors,
    pluginThresholds: pluginContribution?.thresholds,
    pluginVocabulary: pluginContribution?.vocabulary,
  });

  const result = await scan(scanOptions);
  if (result.summary.filesScanned === 0) {
    writeStderr(buildZeroFilesScannedWarning(scanOptions.target, scanOptions.include, false));
  }
  if (result.summary.warnings?.length) {
    for (const warning of result.summary.warnings) {
      writeStderr(`DebtLens warning: ${warning}\n`);
    }
  }

  const baseline = loadBaseline(cwd, baselinePath);
  const comparison = compareBaselineDetailed(result.issues, baseline);
  let wroteBaseline = false;
  if (mode === "prune" && !dryRun) {
    writeBaseline(cwd, baselinePath, pruneBaseline(baseline, comparison));
    wroteBaseline = true;
  }
  if (mode === "update" && !dryRun) {
    writeBaseline(cwd, baselinePath, updateBaseline(result.issues, baseline));
    wroteBaseline = true;
  }

  const output = buildBaselineMaintenanceOutput({
    baseline,
    baselinePath: resolvedBaselinePath,
    comparison,
    wroteBaseline,
  });

  return {
    report: format === "json"
      ? `${JSON.stringify(output, null, 2)}\n`
      : renderBaselineMaintenanceTerminal(mode, output, dryRun),
    exitCode: 0,
    stderr: stderrChunks.join(""),
  };
}

function isScopedPrune(
  target: string,
  cwd: string,
  rawOptions: BaselineMaintenanceOptions,
  fileConfig: DebtLensConfig,
): boolean {
  const isDefaultTarget = target === "." || resolve(cwd, target) === cwd;
  return !isDefaultTarget ||
    rawOptions.include !== undefined ||
    rawOptions.exclude !== undefined ||
    rawOptions.rules !== undefined ||
    (rawOptions.minSeverity !== undefined && String(rawOptions.minSeverity) !== "low") ||
    rawOptions.pack !== undefined ||
    rawOptions.package !== undefined ||
    rawOptions.threshold !== undefined ||
    rawOptions.maxFiles !== undefined ||
    rawOptions.respectGitignore === true ||
    hasScopedConfig(fileConfig);
}

function hasScopedConfig(config: DebtLensConfig): boolean {
  return config.include !== undefined ||
    config.exclude !== undefined ||
    config.rules !== undefined ||
    (config.minSeverity !== undefined && config.minSeverity !== "low") ||
    config.pack !== undefined ||
    config.thresholds !== undefined ||
    config.maxFiles !== undefined ||
    config.respectGitignore === true ||
    config.vocabulary !== undefined ||
    config.propDrilling !== undefined ||
    config.namingDrift !== undefined ||
    config.todoComment !== undefined ||
    config.plugins !== undefined ||
    config.ruleSeverities !== undefined ||
    config.ruleConfidenceFloors !== undefined;
}

interface BaselineMaintenanceFingerprint {
  fingerprint: string;
  baselineCount: number;
  currentCount: number;
  resolvedCount: number;
  snapshot?: {
    ruleId: string;
    file: string;
    severity: string;
  };
}

interface BaselineMaintenanceOutput {
  baselinePath: string;
  delta: BaselineDetailedComparison["delta"];
  newIssues: DebtIssue[];
  resolvedFingerprints: BaselineMaintenanceFingerprint[];
  staleFingerprints: BaselineMaintenanceFingerprint[];
  changedIssues: BaselineChangedIssue[];
  wroteBaseline: boolean;
}

function buildBaselineMaintenanceOutput(input: {
  baseline: Baseline;
  baselinePath: string;
  comparison: BaselineDetailedComparison;
  wroteBaseline: boolean;
}): BaselineMaintenanceOutput {
  const resolvedFingerprints = describeFingerprints(input.baseline, input.comparison);
  return {
    baselinePath: input.baselinePath,
    delta: input.comparison.delta,
    newIssues: input.comparison.newIssues,
    resolvedFingerprints,
    staleFingerprints: resolvedFingerprints,
    changedIssues: input.comparison.changedIssues,
    wroteBaseline: input.wroteBaseline,
  };
}

function describeFingerprints(
  baseline: Baseline,
  comparison: BaselineDetailedComparison,
): BaselineMaintenanceFingerprint[] {
  return Object.entries(comparison.resolvedFingerprints).map(([fingerprint, resolvedCount]) => {
    const baselineCount = baseline.fingerprints[fingerprint] ?? resolvedCount;
    const currentCount = comparison.currentFingerprints[fingerprint] ?? 0;
    const snapshot = baseline.issues?.[fingerprint];
    return {
      fingerprint,
      baselineCount,
      currentCount,
      resolvedCount,
      ...(snapshot
        ? {
            snapshot: {
              ruleId: snapshot.ruleId,
              file: snapshot.file,
              severity: snapshot.severity,
            },
          }
        : {}),
    };
  });
}

export function parseBaselineMaintenanceFormat(value: string): BaselineMaintenanceFormat {
  if (value === "terminal" || value === "json") return value;
  throw new Error(`Invalid baseline format "${value}". Expected terminal or json.`);
}

function renderBaselineMaintenanceTerminal(
  mode: BaselineMaintenanceMode,
  output: {
    baselinePath: string;
    delta: BaselineDetailedComparison["delta"];
    newIssues: DebtIssue[];
    resolvedFingerprints: BaselineMaintenanceFingerprint[];
    changedIssues: BaselineChangedIssue[];
    wroteBaseline: boolean;
  },
  dryRun: boolean,
): string {
  const title = mode === "diff"
    ? "Baseline diff"
    : mode === "prune"
      ? "Baseline prune"
      : "Baseline update";
  const lines = [
    `${title}: ${output.baselinePath}`,
    `New: ${output.delta.new} | Resolved: ${output.delta.resolved} | Changed: ${output.delta.changed} | Severity regressions: ${output.delta.severityRegressions} | Total delta: ${formatSigned(output.delta.totalDelta)}`,
  ];

  if (output.newIssues.length > 0) {
    lines.push("", "New issues:");
    for (const issue of output.newIssues.slice(0, 10)) {
      lines.push(`- ${issue.severity} ${issue.ruleId} ${issue.file}: ${issue.message}`);
    }
    if (output.newIssues.length > 10) {
      lines.push(`- ... ${output.newIssues.length - 10} more`);
    }
  }

  if (output.resolvedFingerprints.length > 0) {
    lines.push("", "Resolved baseline fingerprints:");
    for (const item of output.resolvedFingerprints.slice(0, 10)) {
      const label = item.snapshot
        ? `${item.snapshot.ruleId} ${item.snapshot.file}`
        : item.fingerprint;
      lines.push(`- ${label} (${item.resolvedCount} resolved; ${item.baselineCount} -> ${item.currentCount})`);
    }
    if (output.resolvedFingerprints.length > 10) {
      lines.push(`- ... ${output.resolvedFingerprints.length - 10} more`);
    }
  }

  if (output.changedIssues.length > 0) {
    lines.push("", "Changed baseline issues:");
    for (const item of output.changedIssues.slice(0, 10)) {
      const marker = item.severityRegressed ? " severity regression" : "";
      lines.push(`- ${item.baseline.ruleId} ${item.baseline.file}: ${item.baseline.severity} -> ${item.current.severity}${marker}`);
    }
    if (output.changedIssues.length > 10) {
      lines.push(`- ... ${output.changedIssues.length - 10} more`);
    }
  }

  if (
    output.newIssues.length === 0 &&
    output.resolvedFingerprints.length === 0 &&
    output.changedIssues.length === 0
  ) {
    lines.push("", "No baseline changes detected.");
  }

  if (mode === "diff") {
    lines.push("", "No files written.");
  } else if (dryRun) {
    lines.push("", "Dry run: no files written.");
  } else if (output.wroteBaseline) {
    lines.push("", `Wrote baseline: ${output.baselinePath}`);
  }

  if (mode === "prune" && output.newIssues.length > 0) {
    lines.push("Prune does not add new issues; run `debtlens baseline update` to rewrite the baseline to the current scan.");
  }

  return `${lines.join("\n")}\n`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
