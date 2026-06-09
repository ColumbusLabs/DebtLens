import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DebtIssue, ScanResult, Severity } from "./types.js";

export const DEFAULT_BASELINE_FILENAME = "debtlens-baseline.json";
const BASELINE_VERSION = 1;

// Field delimiter for the fingerprint. normalizeText() collapses all whitespace to a
// single space, so a newline never appears inside a field, making it a delimiter no
// field value can span across.
const FIELD_SEPARATOR = "\n";

export interface Baseline {
  version: number;
  generatedAt: string;
  /** Map of issue fingerprint -> number of occurrences captured. */
  fingerprints: Record<string, number>;
}

/**
 * Normalize a textual part of an issue so the fingerprint survives line shifts and
 * count drift. Digit runs (line numbers AND counts) collapse to `#` and whitespace is
 * squashed — what's left is the structural shape of the finding.
 *
 * Intentional tradeoff: because counts are normalized too, a finding that merely gets
 * "worse" (e.g. a component growing from 250 to 900 lines) keeps the same fingerprint
 * and stays suppressed. A baseline is for not re-nagging about known debt, not for
 * tracking its magnitude, so this is the behavior we want.
 */
function normalizeText(value: string): string {
  return value.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Stable fingerprint for an issue. Deliberately excludes the raw line number so a
 * pre-existing finding stays suppressed when surrounding code moves it up or down.
 */
export function computeFingerprint(issue: DebtIssue): string {
  const parts = [
    issue.ruleId,
    issue.file,
    normalizeText(issue.message),
    normalizeText((issue.evidence ?? []).join("\n")),
  ].join(FIELD_SEPARATOR);
  return fnv1a(parts);
}

export function createBaseline(issues: DebtIssue[]): Baseline {
  const fingerprints: Record<string, number> = {};
  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    fingerprints[fp] = (fingerprints[fp] ?? 0) + 1;
  }
  return {
    version: BASELINE_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprints,
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
  const remaining = new Map<string, number>(Object.entries(baseline.fingerprints));
  const kept: DebtIssue[] = [];
  for (const issue of issues) {
    const fp = computeFingerprint(issue);
    const budget = remaining.get(fp) ?? 0;
    if (budget > 0) {
      remaining.set(fp, budget - 1);
      continue;
    }
    kept.push(issue);
  }
  return kept;
}

/** Apply a baseline to a scan result, returning a new result with a recomputed summary. */
export function applyBaseline(result: ScanResult, baseline: Baseline): ScanResult {
  const issues = filterIssues(result.issues, baseline);
  const suppressedByBaseline = result.issues.length - issues.length;
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
  }
  const filterStats = {
    ...result.summary.filterStats,
    ...(suppressedByBaseline > 0 ? { suppressedByBaseline } : {}),
  };
  return {
    ...result,
    issues,
    summary: {
      ...result.summary,
      totalIssues: issues.length,
      bySeverity,
      byRule,
      ...(Object.keys(filterStats).length > 0 ? { filterStats } : {}),
    },
  };
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `dl_${(hash >>> 0).toString(16)}`;
}
