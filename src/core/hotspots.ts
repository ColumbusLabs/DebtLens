import { groupIssuesByRule, summarizeIssues } from "./issueAggregates.js";
import type { DebtHotspot, DebtIssue, FileChurnMetric, ScanHotspotSummary, Severity } from "./types.js";

const severityWeight: Record<Severity, number> = {
  high: 16,
  medium: 8,
  low: 3,
  info: 1,
};

export interface BuildGitChurnHotspotsInput {
  issues: DebtIssue[];
  churn: FileChurnMetric[];
  window: ScanHotspotSummary["window"];
  fileToRepositoryPath?: Map<string, string>;
  limit?: number;
}

export function buildGitChurnHotspots(input: BuildGitChurnHotspotsInput): ScanHotspotSummary | undefined {
  if (input.issues.length === 0) return undefined;

  const churnByPath = new Map<string, FileChurnMetric>();
  for (const metric of input.churn) {
    churnByPath.set(metric.file, metric);
    churnByPath.set(metric.repositoryPath, metric);
  }

  const byFile = new Map<string, DebtIssue[]>();
  for (const issue of input.issues) {
    const issues = byFile.get(issue.file);
    if (issues) issues.push(issue);
    else byFile.set(issue.file, [issue]);
  }

  const ranking = [...byFile.entries()]
    .map(([file, issues]) => {
      const repositoryPath = input.fileToRepositoryPath?.get(file) ?? file;
      const churn = churnByPath.get(file) ?? churnByPath.get(repositoryPath) ?? zeroChurn(file, repositoryPath);
      return buildHotspot(file, repositoryPath, issues, churn);
    })
    .sort(compareHotspots)
    .slice(0, Math.max(0, input.limit ?? 5));

  if (ranking.length === 0) return undefined;
  return {
    source: "git",
    window: input.window,
    ranking,
  };
}

function buildHotspot(
  file: string,
  repositoryPath: string,
  issues: DebtIssue[],
  churn: FileChurnMetric,
): DebtHotspot {
  const summary = summarizeIssues(issues);
  const distinctRules = new Set(issues.map((issue) => issue.ruleId)).size;
  const topRules = groupIssuesByRule(issues)
    .map(([ruleId, ruleIssues]) => ({ ruleId, count: ruleIssues.length }))
    .sort((left, right) => {
      const countDelta = right.count - left.count;
      if (countDelta !== 0) return countDelta;
      return left.ruleId.localeCompare(right.ruleId);
    })
    .slice(0, 3);
  const debtScore = issues.reduce((total, issue) => total + severityWeight[issue.severity], 0)
    + distinctRules * 4
    + issues.length;
  const churnScore = churn.commits * 3 + Math.min(churn.changedLines, 1000) / 25;
  const score = Number((debtScore + churnScore).toFixed(2));

  return {
    file,
    repositoryPath,
    totalIssues: issues.length,
    distinctRules,
    bySeverity: summary.bySeverity,
    score,
    churn,
    reasons: buildReasons(summary.bySeverity, churn),
    topRules,
  };
}

function buildReasons(bySeverity: Record<Severity, number>, churn: FileChurnMetric): string[] {
  const reasons: string[] = [];
  if (bySeverity.high > 0) reasons.push(`${bySeverity.high} high-severity finding${plural(bySeverity.high)}`);
  if (bySeverity.medium > 0) reasons.push(`${bySeverity.medium} medium-severity finding${plural(bySeverity.medium)}`);
  if (reasons.length === 0 && bySeverity.low > 0) reasons.push(`${bySeverity.low} low-severity finding${plural(bySeverity.low)}`);
  if (reasons.length === 0 && bySeverity.info > 0) reasons.push(`${bySeverity.info} info finding${plural(bySeverity.info)}`);
  if (churn.commits > 0) reasons.push(`${churn.commits} recent commit${plural(churn.commits)}`);
  if (churn.changedLines > 0) reasons.push(`${churn.changedLines} changed line${plural(churn.changedLines)}`);
  if (reasons.length === 0) reasons.push("highest remaining issue concentration");
  return reasons;
}

function compareHotspots(left: DebtHotspot, right: DebtHotspot): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;
  const commitDelta = right.churn.commits - left.churn.commits;
  if (commitDelta !== 0) return commitDelta;
  const changedLineDelta = right.churn.changedLines - left.churn.changedLines;
  if (changedLineDelta !== 0) return changedLineDelta;
  for (const severity of ["high", "medium", "low", "info"] as const) {
    const severityDelta = right.bySeverity[severity] - left.bySeverity[severity];
    if (severityDelta !== 0) return severityDelta;
  }
  const issueDelta = right.totalIssues - left.totalIssues;
  if (issueDelta !== 0) return issueDelta;
  return left.file.localeCompare(right.file);
}

function zeroChurn(file: string, repositoryPath: string): FileChurnMetric {
  return {
    file,
    repositoryPath,
    commits: 0,
    additions: 0,
    deletions: 0,
    changedLines: 0,
  };
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
