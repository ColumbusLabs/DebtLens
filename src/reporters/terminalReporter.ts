import type { ScanResult, Severity } from "../core/types.js";
import { createColorizer } from "../utils/color.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];

export function renderTerminal(result: ScanResult, options: { color: boolean; quiet?: boolean } = { color: true }): string {
  const color = createColorizer(options.color);
  const lines: string[] = [];

  lines.push(color.bold("DebtLens Report"));
  lines.push(`Scanned ${result.summary.filesScanned} files with ${result.summary.rulesRun} rules in ${result.summary.elapsedMs}ms.`);
  lines.push(`Issues: ${result.summary.totalIssues} | high ${result.summary.bySeverity.high} | medium ${result.summary.bySeverity.medium} | low ${result.summary.bySeverity.low} | info ${result.summary.bySeverity.info}`);

  if (options.quiet) {
    return `${lines.join("\n")}\n`;
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
    lines.push(color.severity(severity, color.bold(`${severity.toUpperCase()} (${issues.length})`)));

    for (const issue of issues) {
      const location = issue.location ? `:${issue.location.startLine}` : "";
      lines.push(`  ${color.severity(issue.severity, issue.ruleName)} ${color.gray(`[${issue.ruleId}]`)}`);
      lines.push(`  ${issue.file}${location}`);
      lines.push(`  ${issue.message}`);
      lines.push(`  confidence ${Math.round(issue.confidence * 100)}%`);
      if (issue.evidence?.length) {
        for (const evidence of issue.evidence.slice(0, 3)) {
          lines.push(`  - ${evidence}`);
        }
      }
      if (issue.suggestion) {
        lines.push(`  suggestion: ${issue.suggestion}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
