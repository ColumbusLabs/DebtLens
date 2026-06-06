import type { DebtIssue, ScanResult } from "../core/types.js";

export function renderStepSummary(result: ScanResult): string {
  const { summary } = result;
  const lines: string[] = [
    "## DebtLens",
    "",
    `Scanned **${summary.filesScanned}** files with **${summary.rulesRun}** rules in **${summary.elapsedMs}ms**.`,
    "",
    "| High | Medium | Low | Info | Total |",
    "| ---: | ---: | ---: | ---: | ---: |",
    `| ${summary.bySeverity.high} | ${summary.bySeverity.medium} | ${summary.bySeverity.low} | ${summary.bySeverity.info} | ${summary.totalIssues} |`,
  ];

  if (result.issues.length === 0) {
    lines.push("", "No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "### Top findings", "");
  for (const issue of topIssues(result.issues, 5)) {
    const line = issue.location?.startLine;
    const location = line ? `${issue.file}:${line}` : issue.file;
    lines.push(`- \`${location}\` **${issue.ruleId}** — ${issue.message}`);
  }

  if (result.issues.length > 5) {
    lines.push("", `_…and ${result.issues.length - 5} more finding(s)._`);
  }

  return `${lines.join("\n")}\n`;
}

function topIssues(issues: DebtIssue[], limit: number): DebtIssue[] {
  const rank = { high: 4, medium: 3, low: 2, info: 1 };
  return [...issues]
    .sort((left, right) => {
      const severityDelta = rank[right.severity] - rank[left.severity];
      if (severityDelta !== 0) return severityDelta;
      return right.confidence - left.confidence;
    })
    .slice(0, limit);
}
