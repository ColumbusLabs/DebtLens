import { compareScanResults } from "../core/scanComparison.js";
import type { DebtIssue, ScanResult } from "../core/types.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

export function renderStepSummary(result: ScanResult, options: { previousResult?: unknown } = {}): string {
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

  if (options.previousResult) {
    renderTrend(lines, result, options.previousResult);
  }

  const baselineDelta = summary.deltaFromBaseline;
  if (baselineDelta) {
    lines.push(
      "",
      "### Baseline Delta",
      "",
      `New: **${baselineDelta.new}** · Resolved: **${baselineDelta.resolved}** · Changed: **${baselineDelta.changed}** · Severity regressions: **${baselineDelta.severityRegressions}** · Total: **${formatDelta(baselineDelta.totalDelta)}**`,
    );
  }

  renderSuppressionAudit(lines, result);

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

function renderTrend(lines: string[], result: ScanResult, previousResult: unknown): void {
  const comparison = compareScanResults(previousResult, result);
  lines.push(
    "",
    "### Trend",
    "",
    `New: **${formatMetric(comparison.delta.new)}** · Resolved: **${formatMetric(comparison.delta.resolved)}** · Changed: **${formatMetric(comparison.delta.changed)}** · Severity regressions: **${formatMetric(comparison.delta.severityRegressions)}** · Total: **${formatDelta(comparison.delta.total)}**`,
    "",
    "| Severity | Previous | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const entry of comparison.delta.bySeverity) {
    lines.push(`| ${capitalize(entry.severity)} | ${entry.previous} | ${entry.current} | ${formatDelta(entry.delta)} |`);
  }
  if (comparison.warnings.length > 0) {
    lines.push("", "Trend warnings:", "");
    for (const warning of comparison.warnings) {
      lines.push(`- ${warning}`);
    }
  }
}

function renderSuppressionAudit(lines: string[], result: ScanResult): void {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return;

  const actionItems = directives.filter((directive) => directive.status !== "used" || directive.kind === "file");
  lines.push(
    "",
    "### Suppression Audit",
    "",
    formatSuppressionAuditSummary(summarizeSuppressionDirectives(directives)),
  );
  if (actionItems.length === 0) return;

  lines.push("", "Suppression actions:", "");
  for (const directive of actionItems.slice(0, 5)) {
    lines.push(`- \`${formatSuppressionDirectiveLine(directive)}\` **${directive.ruleId}** (${formatSuppressionKind(directive.kind)}, ${directive.status}) - Reason: ${directive.reason}. Action: ${directive.recommendedAction}`);
  }
  if (actionItems.length > 5) {
    lines.push("", `_...and ${actionItems.length - 5} more suppression action(s)._`);
  }
}

function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatMetric(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
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
