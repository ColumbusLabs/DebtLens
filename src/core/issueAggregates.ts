import type { DebtIssue, DebtHeatmapEntry, RuleCorrelation, ScanCountSummary, Severity } from "./types.js";

export function summarizeIssues(issues: DebtIssue[]): ScanCountSummary {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
  }
  return { totalIssues: issues.length, bySeverity, byRule };
}

export function groupIssuesByFile(issues: DebtIssue[]): Array<[string, DebtIssue[]]> {
  const byFile = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byFile.get(issue.file);
    if (group) group.push(issue);
    else byFile.set(issue.file, [issue]);
  }
  return [...byFile.entries()].sort((left, right) => compareIssueGroups(left, right));
}

export function groupIssuesByRule(issues: DebtIssue[]): Array<[string, DebtIssue[]]> {
  const byRule = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byRule.get(issue.ruleId);
    if (group) group.push(issue);
    else byRule.set(issue.ruleId, [issue]);
  }
  return [...byRule.entries()].sort((left, right) => compareIssueGroups(left, right));
}

export function buildRuleCorrelations(issues: DebtIssue[]): RuleCorrelation[] {
  return groupIssuesByFile(issues)
    .map(([file, fileIssues]) => {
      const rules = groupIssuesByRule(fileIssues)
        .map(([ruleId, ruleIssues]) => ({
          ruleId,
          ruleName: ruleIssues[0]?.ruleName ?? ruleId,
          count: ruleIssues.length,
        }))
        .sort((left, right) => {
          const countDelta = right.count - left.count;
          if (countDelta !== 0) return countDelta;
          return left.ruleId.localeCompare(right.ruleId);
        });
      return { file, totalIssues: fileIssues.length, rules };
    })
    .filter((entry) => entry.rules.length >= 2)
    .sort((left, right) => {
      const issueDelta = right.totalIssues - left.totalIssues;
      if (issueDelta !== 0) return issueDelta;
      const ruleDelta = right.rules.length - left.rules.length;
      if (ruleDelta !== 0) return ruleDelta;
      return left.file.localeCompare(right.file);
    });
}

export function buildDebtHeatmap(issues: DebtIssue[], limit = 10): DebtHeatmapEntry[] {
  return groupIssuesByFile(issues)
    .map(([file, fileIssues]) => ({
      file,
      totalIssues: fileIssues.length,
      distinctRules: new Set(fileIssues.map((issue) => issue.ruleId)).size,
      bySeverity: summarizeIssues(fileIssues).bySeverity,
    }))
    .sort((left, right) => {
      const issueDelta = right.totalIssues - left.totalIssues;
      if (issueDelta !== 0) return issueDelta;
      const ruleDelta = right.distinctRules - left.distinctRules;
      if (ruleDelta !== 0) return ruleDelta;
      return left.file.localeCompare(right.file);
    })
    .slice(0, Math.max(0, limit));
}

function compareIssueGroups(left: [string, DebtIssue[]], right: [string, DebtIssue[]]): number {
  const countDelta = right[1].length - left[1].length;
  if (countDelta !== 0) return countDelta;
  return left[0].localeCompare(right[0]);
}
