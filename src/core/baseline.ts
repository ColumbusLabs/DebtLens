import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DebtIssue, ScanBaselineDelta, ScanCountSummary, ScanResult, Severity } from "./types.js";
import { severityRank } from "./severity.js";
import { buildDuplicateLogicClusters, buildRuleCorrelations, summarizeIssues } from "./issueAggregates.js";
import { computeIssueFingerprint } from "../utils/fingerprint.js";

export const DEFAULT_BASELINE_FILENAME = "debtlens-baseline.json";
const BASELINE_VERSION = 1;

export interface Baseline {
  version: number;
  generatedAt: string;
  /** Map of issue fingerprint -> number of occurrences captured. */
  fingerprints: Record<string, number>;
  /** Optional count snapshot used for regression gates and debt-velocity summaries. */
  summary?: ScanCountSummary;
  /** Optional per-fingerprint metadata used to detect changed findings. */
  issues?: Record<string, BaselineIssueSnapshot>;
}

export interface BaselineIssueSnapshot {
  ruleId: string;
  file: string;
  severity: Severity;
  count: number;
}

/**
 * Stable fingerprint for an issue. Deliberately excludes the raw line number so a
 * pre-existing finding stays suppressed when surrounding code moves it up or down.
 */
export function computeFingerprint(issue: DebtIssue): string {
  return issue.fingerprint ?? computeIssueFingerprint(issue);
}

export function createBaseline(issues: DebtIssue[]): Baseline {
  const fingerprints: Record<string, number> = {};
  const snapshots: Record<string, BaselineIssueSnapshot> = {};
  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    fingerprints[fp] = (fingerprints[fp] ?? 0) + 1;
    snapshots[fp] = {
      ruleId: issue.ruleId,
      file: issue.file,
      severity: issue.severity,
      count: fingerprints[fp],
    };
  }
  return {
    version: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprints,
    summary: summarizeIssues(issues),
    issues: snapshots,
  };
}

export function writeBaseline(cwd: string, path: string, baseline: Baseline): string {
  const target = resolve(cwd, path);
  writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return target;
}

export function loadBaseline(cwd: string, path: string): Baseline {
  const target = resolve(cwd, path);
  if (!existsSync(target)) {
    throw new Error(`Baseline file not found at ${target}. Run with --write-baseline first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse baseline at ${target}: ${message}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Baseline).fingerprints !== "object"
  ) {
    throw new Error(`Invalid baseline file at ${target}: missing "fingerprints".`);
  }
  return parsed as Baseline;
}

/**
 * Drop issues already captured in the baseline. Occurrence counts are respected, so
 * adding a new instance of an already-baselined pattern still surfaces the new one.
 */
export function filterIssues(issues: DebtIssue[], baseline: Baseline): DebtIssue[] {
  return compareBaseline(issues, baseline).newIssues;
}

export function compareBaseline(issues: DebtIssue[], baseline: Baseline): {
  newIssues: DebtIssue[];
  delta: ScanBaselineDelta;
} {
  const remaining = new Map<string, number>(Object.entries(baseline.fingerprints));
  const newIssues: DebtIssue[] = [];
  let changed = 0;
  let severityRegressions = 0;

  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    const budget = remaining.get(fp) ?? 0;
    if (budget > 0) {
      remaining.set(fp, budget - 1);
      const snapshot = baseline.issues?.[fp];
      if (snapshot && snapshot.severity !== issue.severity) {
        changed += 1;
        if (severityRank[issue.severity] > severityRank[snapshot.severity]) {
          severityRegressions += 1;
        }
      }
      continue;
    }
    newIssues.push(issue);
  }

  const baselineSummary = baseline.summary ?? summarizeBaselineFingerprints(baseline);
  const hasBaselineSummary = baseline.summary !== undefined;
  const currentSummary = summarizeIssues(issues);
  const resolved = [...remaining.values()].reduce((sum, count) => sum + Math.max(count, 0), 0);
  return {
    newIssues,
    delta: {
      new: newIssues.length,
      resolved,
      changed,
      severityRegressions,
      totalDelta: currentSummary.totalIssues - baselineSummary.totalIssues,
      baseline: baselineSummary,
      current: currentSummary,
      hasBaselineSummary,
      byRule: compareByRule(baselineSummary.byRule, currentSummary.byRule),
    },
  };
}

/** Apply a baseline to a scan result, returning a new result with a recomputed summary. */
export function applyBaseline(result: ScanResult, baseline: Baseline): ScanResult {
  const comparison = compareBaseline(result.issues, baseline);
  const issues = comparison.newIssues;
  const suppressedByBaseline = result.issues.length - issues.length;
  const summary = summarizeIssues(issues);
  const correlations = buildRuleCorrelations(issues);
  const duplicateClusters = buildDuplicateLogicClusters(issues);
  const filterStats = {
    ...result.summary.filterStats,
    ...(suppressedByBaseline > 0 ? { suppressedByBaseline } : {}),
  };
  return {
    ...result,
    issues,
    summary: {
      ...result.summary,
      totalIssues: summary.totalIssues,
      bySeverity: summary.bySeverity,
      byRule: summary.byRule,
      ...(Object.keys(filterStats).length > 0 ? { filterStats } : {}),
      deltaFromBaseline: comparison.delta,
      ...(correlations.length > 0 ? { correlations } : { correlations: undefined }),
      ...(duplicateClusters.length > 0 ? { duplicateClusters } : { duplicateClusters: undefined }),
    },
  };
}

function summarizeBaselineFingerprints(baseline: Baseline): ScanCountSummary {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  let totalIssues = 0;

  for (const [fingerprint, count] of Object.entries(baseline.fingerprints)) {
    totalIssues += count;
    const snapshot = baseline.issues?.[fingerprint];
    if (!snapshot) continue;
    bySeverity[snapshot.severity] += count;
    byRule[snapshot.ruleId] = (byRule[snapshot.ruleId] ?? 0) + count;
  }

  return { totalIssues, bySeverity, byRule };
}

function compareByRule(
  baseline: Record<string, number>,
  current: Record<string, number>,
): Record<string, { baseline: number; current: number; delta: number }> {
  const ruleIds = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  const result: Record<string, { baseline: number; current: number; delta: number }> = {};
  for (const ruleId of [...ruleIds].sort()) {
    const baselineCount = baseline[ruleId] ?? 0;
    const currentCount = current[ruleId] ?? 0;
    result[ruleId] = {
      baseline: baselineCount,
      current: currentCount,
      delta: currentCount - baselineCount,
    };
  }
  return result;
}
