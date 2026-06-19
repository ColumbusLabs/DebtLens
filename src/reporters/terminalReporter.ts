import { groupIssuesByFile, groupIssuesByRule } from "../core/issueAggregates.js";
import type { DebtIssue, ScanResult, Severity, TerminalGroupBy } from "../core/types.js";
import { createColorizer } from "../utils/color.js";
import { formatFilterStats } from "./filterStats.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];

export function renderTerminal(
  result: ScanResult,
  options: { color: boolean; quiet?: boolean; groupBy?: TerminalGroupBy } = { color: true },
): string {
  const color = createColorizer(options.color);
  const lines: string[] = [];

  lines.push(color.bold("DebtLens Report"));
  lines.push(`Scanned ${result.summary.filesScanned} files with ${result.summary.rulesRun} rules in ${result.summary.elapsedMs}ms.`);
  lines.push(`Issues: ${result.summary.totalIssues} | high ${result.summary.bySeverity.high} | medium ${result.summary.bySeverity.medium} | low ${result.summary.bySeverity.low} | info ${result.summary.bySeverity.info}`);
  const filterStats = formatFilterStats(result.summary.filterStats);
  if (filterStats) {
    lines.push(`Filtered: ${filterStats}`);
  }
  renderSuppressionAuditSummary(lines, result);

  if (options.quiet) {
    return `${lines.join("\n")}\n`;
  }

  renderSuppressionAuditDetails(lines, result);

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  renderHotspots(lines, result, color);

  if (options.groupBy === "rule") {
    renderGroups(lines, result.issues, groupIssuesByRule(result.issues), "rule", color);
  } else if (options.groupBy === "file") {
    renderGroups(lines, result.issues, groupIssuesByFile(result.issues), "file", color);
  } else {
    for (const severity of severityOrder) {
    const issues = result.issues.filter((issue) => issue.severity === severity);
    if (issues.length === 0) continue;
    lines.push("");
    lines.push(color.severity(severity, color.bold(`${severity.toUpperCase()} (${issues.length})`)));

    for (const issue of issues) {
      renderIssue(lines, issue, color);
    }
  }
  }

  return `${lines.join("\n")}\n`;
}

function renderHotspots(lines: string[], result: ScanResult, color: ReturnType<typeof createColorizer>): void {
  const hotspots = result.summary.hotspots?.ranking ?? [];
  if (hotspots.length === 0) return;

  lines.push("");
  lines.push(color.bold("Git churn hotspots"));
  lines.push(`Optional git-derived ranking from ${formatHotspotWindow(result.summary.hotspots?.window)}.`);
  for (const hotspot of hotspots.slice(0, 5)) {
    lines.push(`  ${hotspot.file} | score ${hotspot.score} | ${hotspot.churn.commits} commit${hotspot.churn.commits === 1 ? "" : "s"}, ${hotspot.churn.changedLines} changed line${hotspot.churn.changedLines === 1 ? "" : "s"}`);
    lines.push(`  ${hotspot.reasons.join("; ")}`);
  }
}

function formatHotspotWindow(window: NonNullable<ScanResult["summary"]["hotspots"]>["window"] | undefined): string {
  if (!window) return "the configured git window";
  if (window.range) return `git range ${window.range}`;
  if (window.days) return `the last ${window.days} day${window.days === 1 ? "" : "s"}`;
  return "the configured git window";
}

function renderSuppressionAuditSummary(lines: string[], result: ScanResult): void {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return;
  lines.push(`Suppression audit: ${formatSuppressionAuditSummary(summarizeSuppressionDirectives(directives))}`);
}

function renderSuppressionAuditDetails(lines: string[], result: ScanResult): void {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return;

  lines.push("");
  lines.push("Suppression audit");
  for (const directive of directives) {
    const target = directive.targetLine ? ` -> target line ${directive.targetLine}` : "";
    lines.push(`  ${directive.status} ${formatSuppressionKind(directive.kind)} ${formatSuppressionDirectiveLine(directive)} [${directive.ruleId}]${target}`);
    lines.push(`  hidden findings: ${directive.suppressedIssueCount}`);
    lines.push(`  reason: ${directive.reason}`);
    lines.push(`  action: ${directive.recommendedAction}`);
    lines.push("");
  }
}

function renderGroups(
  lines: string[],
  allIssues: DebtIssue[],
  groups: Array<[string, DebtIssue[]]>,
  label: "rule" | "file",
  color: ReturnType<typeof createColorizer>,
): void {
  lines.push("");
  lines.push(color.bold(`Grouped by ${label} (${allIssues.length})`));
  for (const [name, issues] of groups) {
    lines.push("");
    lines.push(color.bold(`${name} (${issues.length})`));
    for (const issue of issues) {
      renderIssue(lines, issue, color);
    }
  }
}

function renderIssue(
  lines: string[],
  issue: DebtIssue,
  color: ReturnType<typeof createColorizer>,
): void {
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
