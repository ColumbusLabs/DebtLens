import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DebtIssue, ScanBaselineDelta, ScanCountSummary, ScanResult, Severity } from "./types.js";
import { severityRank } from "./severity.js";
import { buildDuplicateLogicClusters, buildRuleCorrelations, summarizeIssues } from "./issueAggregates.js";
import { computeIssueFingerprint } from "../utils/fingerprint.js";

export const DEFAULT_BASELINE_FILENAME = "debtlens-baseline.json";
const BASELINE_VERSION = 1;

export interface Baseline {
  [key: string]: unknown;
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
  [key: string]: unknown;
  ruleId: string;
  file: string;
  severity: Severity;
  count: number;
}

export interface BaselineFingerprintChange {
  fingerprint: string;
  baseline: BaselineIssueSnapshot;
  current: BaselineIssueSnapshot;
  occurrenceCount: number;
  severityRegressed: boolean;
}

export interface BaselineChangedIssue {
  fingerprint: string;
  issue: DebtIssue;
  baseline: BaselineIssueSnapshot;
  current: BaselineIssueSnapshot;
  severityRegressed: boolean;
}

export interface BaselineDetailedComparison {
  /** Current findings not covered by the baseline, preserving the existing compareBaseline behavior. */
  newIssues: DebtIssue[];
  delta: ScanBaselineDelta;
  /** All fingerprints in the current scan with occurrence counts. */
  currentFingerprints: Record<string, number>;
  /** Baselined fingerprint occurrences that are still present in the current scan. */
  activeFingerprints: Record<string, number>;
  /** Current fingerprint occurrences beyond the baseline allowance. */
  newFingerprints: Record<string, number>;
  /** Baseline fingerprint occurrences no longer present in the current scan. */
  resolvedFingerprints: Record<string, number>;
  /** Alias for resolved baseline occurrences, named for prune/update workflows. */
  staleFingerprints: Record<string, number>;
  /** Covered issues whose metadata changed while remaining in the baseline. */
  changedIssues: BaselineChangedIssue[];
  /** Baselined fingerprints whose metadata changed while remaining covered by the baseline. */
  changedFingerprints: Record<string, BaselineFingerprintChange>;
}

export interface UpdateBaselineOptions {
  generatedAt?: string | Date;
}

/**
 * Stable fingerprint for an issue. Deliberately excludes the raw line number so a
 * pre-existing finding stays suppressed when surrounding code moves it up or down.
 */
export function computeFingerprint(issue: DebtIssue): string {
  return issue.fingerprint ?? computeIssueFingerprint(issue);
}

export function createBaseline(issues: DebtIssue[]): Baseline {
  const { fingerprints, snapshots } = buildBaselineState(issues);
  return {
    version: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprints,
    summary: summarizeIssues(issues),
    issues: snapshots,
  };
}

/** Add findings to an existing baseline while keeping counts and snapshots in sync. */
export function addIssuesToBaseline(baseline: Baseline, issues: DebtIssue[]): Baseline {
  baseline.issues ??= {};
  for (const issue of issues) {
    const fingerprint = computeFingerprint(issue);
    const count = (baseline.fingerprints[fingerprint] ?? 0) + 1;
    baseline.fingerprints[fingerprint] = count;
    baseline.issues[fingerprint] = snapshotIssue(issue, count);
  }
  baseline.fingerprints = sortRecord(baseline.fingerprints);
  baseline.issues = sortRecord(baseline.issues);
  baseline.summary = summarizeBaselineFingerprints(baseline);
  baseline.generatedAt = new Date().toISOString();
  return baseline;
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
  const comparison = compareBaselineDetailed(issues, baseline);
  return {
    newIssues: comparison.newIssues,
    delta: comparison.delta,
  };
}

export function compareBaselineDetailed(
  issues: DebtIssue[],
  baseline: Baseline,
): BaselineDetailedComparison {
  const currentState = buildBaselineState(issues);
  const remaining = new Map<string, number>(Object.entries(baseline.fingerprints));
  const activeFingerprints: Record<string, number> = {};
  const newFingerprints: Record<string, number> = {};
  const changedIssues: BaselineChangedIssue[] = [];
  const changedFingerprints: Record<string, BaselineFingerprintChange> = {};
  const newIssues: DebtIssue[] = [];
  let changed = 0;
  let severityRegressions = 0;

  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    const budget = remaining.get(fp) ?? 0;
    if (budget > 0) {
      remaining.set(fp, budget - 1);
      activeFingerprints[fp] = (activeFingerprints[fp] ?? 0) + 1;
      const snapshot = baseline.issues?.[fp];
      if (snapshot && snapshot.severity !== issue.severity) {
        changed += 1;
        const severityRegressed = severityRank[issue.severity] > severityRank[snapshot.severity];
        const current = currentState.snapshots[fp] ?? snapshotIssue(issue, currentState.fingerprints[fp] ?? 1);
        changedIssues.push({
          fingerprint: fp,
          issue,
          baseline: snapshot,
          current,
          severityRegressed,
        });
        const existing = changedFingerprints[fp];
        changedFingerprints[fp] = existing
          ? {
              ...existing,
              occurrenceCount: existing.occurrenceCount + 1,
              severityRegressed: existing.severityRegressed || severityRegressed,
            }
          : {
              fingerprint: fp,
              baseline: snapshot,
              current,
              occurrenceCount: 1,
              severityRegressed,
            };
        if (severityRank[issue.severity] > severityRank[snapshot.severity]) {
          severityRegressions += 1;
        }
      }
      continue;
    }
    newFingerprints[fp] = (newFingerprints[fp] ?? 0) + 1;
    newIssues.push(issue);
  }

  const staleFingerprints: Record<string, number> = {};
  for (const [fingerprint, count] of remaining) {
    if (count > 0) staleFingerprints[fingerprint] = count;
  }

  const baselineSummary = baseline.summary ?? summarizeBaselineFingerprints(baseline);
  const hasBaselineSummary = baseline.summary !== undefined;
  const currentSummary = summarizeIssues(issues);
  const resolved = Object.values(staleFingerprints).reduce((sum, count) => sum + count, 0);
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
    currentFingerprints: sortRecord(currentState.fingerprints),
    activeFingerprints: sortRecord(activeFingerprints),
    newFingerprints: sortRecord(newFingerprints),
    resolvedFingerprints: sortRecord(staleFingerprints),
    staleFingerprints: sortRecord(staleFingerprints),
    changedIssues,
    changedFingerprints: sortRecord(changedFingerprints),
  };
}

export function pruneBaseline(baseline: Baseline, comparison: BaselineDetailedComparison): Baseline {
  const fingerprints = sortRecord(comparison.activeFingerprints);
  const prunedIssues = pruneIssueSnapshots(baseline.issues, fingerprints);
  return {
    ...baseline,
    fingerprints,
    ...(baseline.summary ? { summary: summarizeBaselineFingerprints({ ...baseline, fingerprints, issues: prunedIssues }) } : {}),
    ...(baseline.issues ? { issues: prunedIssues } : {}),
  };
}

export function updateBaseline(
  issues: DebtIssue[],
  previousBaseline?: Baseline,
  options: UpdateBaselineOptions = {},
): Baseline {
  const generatedAt = options.generatedAt instanceof Date
    ? options.generatedAt.toISOString()
    : options.generatedAt ?? new Date().toISOString();
  const updated = createBaseline(issues);
  return {
    ...previousBaseline,
    ...updated,
    version: BASELINE_VERSION,
    generatedAt,
  };
}

/** Apply a baseline to a scan result, returning a new result with a recomputed summary. */
export function applyBaseline(result: ScanResult, baseline: Baseline): ScanResult {
  const comparison = compareBaseline(result.issues, baseline);
  const issues = comparison.newIssues as ScanResult["issues"];
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

function buildBaselineState(issues: DebtIssue[]): {
  fingerprints: Record<string, number>;
  snapshots: Record<string, BaselineIssueSnapshot>;
} {
  const fingerprints: Record<string, number> = {};
  const snapshots: Record<string, BaselineIssueSnapshot> = {};
  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    const count = (fingerprints[fp] ?? 0) + 1;
    fingerprints[fp] = count;
    snapshots[fp] = snapshotIssue(issue, count);
  }
  return {
    fingerprints: sortRecord(fingerprints),
    snapshots: sortRecord(snapshots),
  };
}

function snapshotIssue(issue: DebtIssue, count: number): BaselineIssueSnapshot {
  return {
    ruleId: issue.ruleId,
    file: issue.file,
    severity: issue.severity,
    count,
  };
}

function pruneIssueSnapshots(
  snapshots: Record<string, BaselineIssueSnapshot> | undefined,
  fingerprints: Record<string, number>,
): Record<string, BaselineIssueSnapshot> | undefined {
  if (!snapshots) return undefined;
  const pruned: Record<string, BaselineIssueSnapshot> = {};
  for (const fingerprint of Object.keys(fingerprints).sort()) {
    const snapshot = snapshots[fingerprint];
    if (!snapshot) continue;
    pruned[fingerprint] = {
      ...snapshot,
      count: fingerprints[fingerprint] ?? snapshot.count,
    };
  }
  return pruned;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
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
