import type { DebtIssue, ScanHotspotSummary, Severity } from "./types.js";

const defaultSeverityWeight: Record<Severity, number> = {
  high: 16,
  medium: 8,
  low: 3,
  info: 1,
};

export interface PriorityWeights {
  severity?: Partial<Record<Severity, number>>;
  churn?: number;
  age?: number;
}

export const defaultPriorityWeights: Required<PriorityWeights> = {
  severity: defaultSeverityWeight,
  churn: 1,
  age: 0.5,
};

export function computePayoffScore(
  issue: DebtIssue,
  context: {
    churnByFile?: Map<string, number>;
    weights?: PriorityWeights;
  } = {},
): number {
  const weights = {
    severity: { ...defaultSeverityWeight, ...(context.weights?.severity ?? {}) },
    churn: context.weights?.churn ?? defaultPriorityWeights.churn,
    age: context.weights?.age ?? defaultPriorityWeights.age,
  };
  const severityFactor = weights.severity[issue.severity] ?? 1;
  const confidenceFactor = Math.max(0.35, issue.confidence);
  const churnMetric = context.churnByFile?.get(issue.file)
    ?? context.churnByFile?.get(normalizeRepositoryPath(issue.file))
    ?? 0;
  const churnFactor = 1 + Math.log2(1 + churnMetric) * weights.churn;
  const ageFactor = issue.introducedDaysAgo !== undefined
    ? 1 + Math.min(issue.introducedDaysAgo / 365, 2) * weights.age
    : 1;
  return Number((severityFactor * confidenceFactor * churnFactor * ageFactor).toFixed(4));
}

export function enrichIssuesWithPayoffScores(
  issues: DebtIssue[],
  context: {
    hotspots?: ScanHotspotSummary;
    weights?: PriorityWeights;
  } = {},
): void {
  const churnByFile = buildChurnLookup(context.hotspots);
  for (const issue of issues) {
    issue.payoffScore = computePayoffScore(issue, { churnByFile, weights: context.weights });
  }
}

export function sortIssuesByPayoff(issues: DebtIssue[]): DebtIssue[] {
  return [...issues].sort((left, right) => {
    const scoreDelta = (right.payoffScore ?? 0) - (left.payoffScore ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    const fileDelta = left.file.localeCompare(right.file);
    if (fileDelta !== 0) return fileDelta;
    return (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0);
  });
}

export function topPayoffIssues(issues: DebtIssue[], limit = 10): DebtIssue[] {
  return sortIssuesByPayoff(issues).slice(0, Math.max(0, limit));
}

function buildChurnLookup(hotspots?: ScanHotspotSummary): Map<string, number> | undefined {
  if (!hotspots?.ranking.length) return undefined;
  const lookup = new Map<string, number>();
  for (const hotspot of hotspots.ranking) {
    lookup.set(hotspot.file, hotspot.churn.commits + hotspot.churn.changedLines / 100);
    lookup.set(hotspot.repositoryPath, hotspot.churn.commits + hotspot.churn.changedLines / 100);
  }
  return lookup;
}

function normalizeRepositoryPath(file: string): string {
  return file.replaceAll("\\", "/");
}
