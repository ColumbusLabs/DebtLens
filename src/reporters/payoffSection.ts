import { topPayoffIssues } from "../core/priority.js";
import type { DebtIssue, ScanResult } from "../core/types.js";

export function hasPayoffScores(issues: DebtIssue[]): boolean {
  return issues.some((issue) => issue.payoffScore !== undefined);
}

export function renderPayoffSectionTerminal(issues: DebtIssue[], limit = 10): string[] {
  if (!hasPayoffScores(issues)) return [];
  const lines = ["", "Top payoff targets:"];
  for (const issue of topPayoffIssues(issues, limit)) {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    lines.push(`  ${issue.payoffScore?.toFixed(2)}  [${issue.severity}] ${issue.ruleName} — ${location}`);
    lines.push(`    ${issue.message}`);
  }
  return lines;
}

export function renderPayoffSectionMarkdown(issues: DebtIssue[], limit = 10): string[] {
  if (!hasPayoffScores(issues)) return [];
  const lines = ["", "## Top payoff targets", ""];
  for (const issue of topPayoffIssues(issues, limit)) {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    lines.push(`- **${issue.payoffScore?.toFixed(2)}** [${issue.severity}] \`${issue.ruleId}\` — \`${location}\` — ${issue.message}`);
  }
  return lines;
}

export function renderPayoffSectionHtml(issues: DebtIssue[], limit = 10): string {
  if (!hasPayoffScores(issues)) return "";
  const rows = topPayoffIssues(issues, limit).map((issue) => {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    return `<tr><td>${issue.payoffScore?.toFixed(2)}</td><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.ruleName)}</td><td><code>${escapeHtml(location)}</code></td><td>${escapeHtml(issue.message)}</td></tr>`;
  }).join("\n");
  return `<h2>Top payoff targets</h2><table><thead><tr><th>Score</th><th>Severity</th><th>Rule</th><th>Location</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function scanHasPayoffData(result: ScanResult): boolean {
  return hasPayoffScores(result.issues);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
