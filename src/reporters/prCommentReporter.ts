import type { DebtIssue, ScanResult } from "../core/types.js";
import { formatFilterStats } from "./filterStats.js";

export interface PrCommentOptions {
  sourceUrlBase?: string;
}

export function renderPrComment(result: ScanResult, options: PrCommentOptions = {}): string {
  const lines: string[] = [];
  lines.push("## DebtLens findings");
  lines.push("");
  lines.push("| Files scanned | Rules run | Total issues | High | Medium | Low | Info |");
  lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  lines.push(`| ${result.summary.filesScanned} | ${result.summary.rulesRun} | ${result.summary.totalIssues} | ${result.summary.bySeverity.high} | ${result.summary.bySeverity.medium} | ${result.summary.bySeverity.low} | ${result.summary.bySeverity.info} |`);
  const filterStats = formatFilterStats(result.summary.filterStats);
  if (filterStats) {
    lines.push("");
    lines.push(`Filtered: ${filterStats}`);
  }

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push("### Grouped annotations");

  for (const [file, issues] of groupIssuesByFile(result.issues)) {
    lines.push("");
    lines.push(`#### \`${file}\``);
    lines.push("");

    for (const issue of issues) {
      const location = renderLocation(issue, options.sourceUrlBase);
      lines.push(`- **${capitalize(issue.severity)}** ${issue.ruleName} (\`${issue.ruleId}\`) at ${location}: ${issue.message}`);
      lines.push(`  - Confidence: **${Math.round(issue.confidence * 100)}%**`);

      if (issue.evidence?.length) {
        lines.push(`  - Evidence: ${issue.evidence.join("; ")}`);
      }

      if (issue.suggestion) {
        lines.push(`  - Suggestion: ${issue.suggestion}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function groupIssuesByFile(issues: DebtIssue[]): Array<[string, DebtIssue[]]> {
  const byFile = new Map<string, DebtIssue[]>();
  for (const issue of issues) {
    const group = byFile.get(issue.file);
    if (group) {
      group.push(issue);
    } else {
      byFile.set(issue.file, [issue]);
    }
  }
  return [...byFile.entries()];
}

function renderLocation(issue: DebtIssue, sourceUrlBase: string | undefined): string {
  const line = issue.location?.startLine;
  const label = line ? `${issue.file}:${line}` : issue.file;
  if (!line || !sourceUrlBase) return `\`${label}\``;
  return `[\`${label}\`](${sourceUrlBase}/${encodePath(issue.file)}#L${line})`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
