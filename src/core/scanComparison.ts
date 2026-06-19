import { compareBaselineDetailed, createBaseline } from "./baseline.js";
import { groupIssuesByFile, summarizeIssues } from "./issueAggregates.js";
import type { DebtIssue, ScanCountSummary, ScanOptions, ScanResult, Severity } from "./types.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];
const comparableOptionKeys = ["target", "include", "exclude", "minSeverity", "rules"] as const;

export interface RuleTrendDelta {
  ruleId: string;
  previous: number;
  current: number;
  delta: number;
}

export interface SeverityTrendDelta {
  severity: Severity;
  previous: number;
  current: number;
  delta: number;
}

export interface CompareTopNewFile {
  file: string;
  count: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
}

export interface ComparableScanSnapshot {
  summary: ScanCountSummary;
  issues?: DebtIssue[];
  warnings: string[];
  source: "schema-v1" | "best-effort";
  options?: Partial<Pick<ScanOptions, "target" | "include" | "exclude" | "minSeverity" | "rules">>;
}

export interface ScanTrendComparison {
  previous: ScanCountSummary;
  current: ScanCountSummary;
  delta: {
    total: number;
    new: number | null;
    resolved: number | null;
    changed: number | null;
    severityRegressions: number | null;
    bySeverity: SeverityTrendDelta[];
    byRule: RuleTrendDelta[];
  };
  topNewFiles: CompareTopNewFile[];
  accuracy: {
    issueIdentity: "exact" | "unavailable";
  };
  warnings: string[];
}

export function compareScanResults(
  previousResult: ScanResult | ComparableScanSnapshot | unknown,
  currentResult: ScanResult | ComparableScanSnapshot | unknown,
  options: { topFileLimit?: number; previousLabel?: string; currentLabel?: string } = {},
): ScanTrendComparison {
  const previousSnapshot = normalizeComparableScanSnapshot(previousResult, {
    label: options.previousLabel ?? "previous",
  });
  const currentSnapshot = normalizeComparableScanSnapshot(currentResult, {
    label: options.currentLabel ?? "current",
  });
  const previous = previousSnapshot.summary;
  const current = currentSnapshot.summary;
  const detailed = previousSnapshot.issues && currentSnapshot.issues
    ? compareBaselineDetailed(currentSnapshot.issues, createBaseline(previousSnapshot.issues))
    : undefined;
  const warnings = [
    ...previousSnapshot.warnings,
    ...currentSnapshot.warnings,
    ...compareScanOptions(previousSnapshot, currentSnapshot),
  ];

  return {
    previous,
    current,
    delta: {
      total: current.totalIssues - previous.totalIssues,
      new: detailed?.delta.new ?? null,
      resolved: detailed?.delta.resolved ?? null,
      changed: detailed?.delta.changed ?? null,
      severityRegressions: detailed?.delta.severityRegressions ?? null,
      bySeverity: compareSeverityCounts(previous, current),
      byRule: compareRuleCounts(previous, current),
    },
    topNewFiles: detailed ? buildTopNewFiles(detailed.newIssues, options.topFileLimit ?? 5) : [],
    accuracy: {
      issueIdentity: detailed ? "exact" : "unavailable",
    },
    warnings,
  };
}

export function normalizeComparableScanSnapshot(
  input: unknown,
  options: { label?: string } = {},
): ComparableScanSnapshot {
  const label = options.label ?? "report";
  if (!isRecord(input)) {
    throw new Error(`Invalid ${label} report: expected a JSON object.`);
  }

  if (isComparableScanSnapshot(input)) {
    return input;
  }

  const warnings: string[] = [];
  if (input.schemaVersion !== 1) {
    warnings.push(`${label} report does not declare schemaVersion: 1; comparing with best-effort defaults.`);
  }

  const issues = Array.isArray(input.issues) ? input.issues as DebtIssue[] : undefined;
  const declaredSummary = readScanCountSummary(input.summary);
  const optionsValue = isRecord(input.options) ? readComparableOptions(input.options) : undefined;
  if (!issues && !declaredSummary) {
    throw new Error(`Invalid ${label} report: missing usable "summary" counts or "issues" array.`);
  }

  if (!issues) {
    return {
      summary: declaredSummary as ScanCountSummary,
      warnings,
      source: input.schemaVersion === 1 ? "schema-v1" : "best-effort",
      options: optionsValue,
    };
  }

  const computedSummary = summarizeIssues(issues);
  if (!declaredSummary) {
    warnings.push(`${label} report is missing or has incomplete summary counts; recomputing counts from issues.`);
  } else if (!sameSummary(declaredSummary, computedSummary)) {
    warnings.push(`${label} report summary does not match its issues array; recomputing counts from issues.`);
  }

  return {
    summary: computedSummary,
    issues,
    warnings,
    source: input.schemaVersion === 1 ? "schema-v1" : "best-effort",
    options: optionsValue,
  };
}

function compareSeverityCounts(previous: ScanCountSummary, current: ScanCountSummary): SeverityTrendDelta[] {
  return severityOrder.map((severity) => ({
    severity,
    previous: previous.bySeverity[severity],
    current: current.bySeverity[severity],
    delta: current.bySeverity[severity] - previous.bySeverity[severity],
  }));
}

function compareRuleCounts(previous: ScanCountSummary, current: ScanCountSummary): RuleTrendDelta[] {
  const ruleIds = new Set([...Object.keys(previous.byRule), ...Object.keys(current.byRule)]);
  return [...ruleIds]
    .map((ruleId) => ({
      ruleId,
      previous: previous.byRule[ruleId] ?? 0,
      current: current.byRule[ruleId] ?? 0,
      delta: (current.byRule[ruleId] ?? 0) - (previous.byRule[ruleId] ?? 0),
    }))
    .sort((left, right) => {
      const delta = Math.abs(right.delta) - Math.abs(left.delta);
      if (delta !== 0) return delta;
      const currentDelta = right.current - left.current;
      if (currentDelta !== 0) return currentDelta;
      return left.ruleId.localeCompare(right.ruleId);
    });
}

function buildTopNewFiles(issues: DebtIssue[], limit: number): CompareTopNewFile[] {
  return groupIssuesByFile(issues)
    .map(([file, fileIssues]) => {
      const summary = summarizeIssues(fileIssues);
      return {
        file,
        count: fileIssues.length,
        bySeverity: summary.bySeverity,
        byRule: summary.byRule,
      };
    })
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return left.file.localeCompare(right.file);
    })
    .slice(0, Math.max(0, limit));
}

function readScanCountSummary(value: unknown): ScanCountSummary | undefined {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.totalIssues)) return undefined;
  const bySeverity = readSeverityCounts(value.bySeverity);
  if (!bySeverity) return undefined;
  const byRule = readRuleCounts(value.byRule);
  if (!byRule) return undefined;
  return { totalIssues: value.totalIssues, bySeverity, byRule };
}

function readSeverityCounts(value: unknown): Record<Severity, number> | undefined {
  if (!isRecord(value)) return undefined;
  const counts = {
    info: value.info,
    low: value.low,
    medium: value.medium,
    high: value.high,
  };
  if (!isFiniteNumber(counts.info) || !isFiniteNumber(counts.low) || !isFiniteNumber(counts.medium) || !isFiniteNumber(counts.high)) {
    return undefined;
  }
  return counts as Record<Severity, number>;
}

function readRuleCounts(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const counts: Record<string, number> = {};
  for (const [ruleId, count] of Object.entries(value)) {
    if (!isFiniteNumber(count)) return undefined;
    counts[ruleId] = count;
  }
  return counts;
}

function readComparableOptions(value: Record<string, unknown>): ComparableScanSnapshot["options"] {
  return {
    target: typeof value.target === "string" ? value.target : undefined,
    include: readStringArray(value.include),
    exclude: readStringArray(value.exclude),
    minSeverity: isSeverity(value.minSeverity) ? value.minSeverity : undefined,
    rules: readStringArray(value.rules),
  };
}

function compareScanOptions(previous: ComparableScanSnapshot, current: ComparableScanSnapshot): string[] {
  if (!previous.options || !current.options) return [];
  const changed = comparableOptionKeys.filter((key) => !sameComparableOption(previous.options?.[key], current.options?.[key]));
  if (changed.length === 0) return [];
  return [`scan options differ (${changed.join(", ")}); compare trends are most meaningful for matching scan scope.`];
}

function sameComparableOption(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameSummary(left: ScanCountSummary, right: ScanCountSummary): boolean {
  return left.totalIssues === right.totalIssues &&
    sameComparableOption(left.bySeverity, right.bySeverity) &&
    sameComparableOption(left.byRule, right.byRule);
}

function isComparableScanSnapshot(input: unknown): input is ComparableScanSnapshot {
  if (!isRecord(input)) return false;
  return readScanCountSummary(input.summary) !== undefined &&
    Array.isArray(input.warnings) &&
    (input.source === "schema-v1" || input.source === "best-effort");
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? value : undefined;
}

function isSeverity(value: unknown): value is Severity {
  return value === "info" || value === "low" || value === "medium" || value === "high";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
