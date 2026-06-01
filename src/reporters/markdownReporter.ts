import type { ScanResult, Severity } from "../core/types.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];

export function renderMarkdown(result: ScanResult): string {
  const lines: string[] = [];
  lines.push("# DebtLens Report");
  lines.push("");
  lines.push(`Scanned **${result.summary.filesScanned}** files with **${result.summary.rulesRun}** rules in **${result.summary.elapsedMs}ms**.`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total issues: **${result.summary.totalIssues}**`);
  for (const severity of severityOrder) {
    lines.push(`- ${capitalize(severity)}: **${result.summary.bySeverity[severity]}**`);
  }

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  for (const severity of severityOrder) {
    const issues = result.issues.filter((issue) => issue.severity === severity);
    if (issues.length === 0) continue;
    lines.push("");
    lines.push(`## ${capitalize(severity)} severity`);
    lines.push("");
    for (const issue of issues) {
      const location = issue.location ? `:${issue.location.startLine}` : "";
      lines.push(`### ${issue.ruleName} — \`${issue.file}${location}\``);
      lines.push("");
      lines.push(issue.message);
      lines.push("");
      lines.push(`Confidence: **${Math.round(issue.confidence * 100)}%**`);
      if (issue.evidence?.length) {
        lines.push("");
        lines.push("Evidence:");
        for (const evidence of issue.evidence) {
          lines.push(`- ${evidence}`);
        }
      }
      if (issue.suggestion) {
        lines.push("");
        lines.push(`Suggestion: ${issue.suggestion}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
