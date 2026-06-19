import { compareScanResults } from "../core/scanComparison.js";
import type { DebtIssue, ScanResult, Severity } from "../core/types.js";
import { formatFilterStats } from "./filterStats.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

export interface StepSummaryOptions {
  previousResult?: unknown;
  previousReportWarning?: string;
  gate?: {
    scanStatus?: number;
    failOn?: string;
    failOnConfidence?: number;
    failOnRegression?: boolean;
  };
  reports?: {
    format?: string;
    reportPath?: string;
    jsonPath?: string;
    jsonArtifactName?: string;
  };
}

export function renderStepSummary(result: ScanResult, options: StepSummaryOptions = {}): string {
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

  renderGateDecision(lines, result, options.gate);

  if (options.previousResult) {
    renderTrend(lines, result, options.previousResult);
  } else if (options.previousReportWarning) {
    lines.push("", "### Trend", "", options.previousReportWarning);
  }

  renderWarnings(lines, result);
  renderFilterStats(lines, result);
  renderReports(lines, options.reports);

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

function renderGateDecision(lines: string[], result: ScanResult, gate: StepSummaryOptions["gate"]): void {
  if (!gate) return;
  const scanStatus = gate.scanStatus ?? 0;
  const status = scanStatus === 0 ? "Passed" : "Failed";
  lines.push("", "### Gate Decision", "", `**${status}.** ${gateReason(result, gate)}`);
}

function gateReason(result: ScanResult, gate: NonNullable<StepSummaryOptions["gate"]>): string {
  if ((gate.scanStatus ?? 0) === 0) {
    if (gate.failOn || gate.failOnRegression) return "No configured fail-on gate was triggered.";
    return "Scan completed without a configured blocking gate.";
  }

  const reasons: string[] = [];
  const failOn = parseSeverity(gate.failOn);
  if (failOn) {
    const count = countAtOrAboveSeverity(result, failOn, gate.failOnConfidence);
    const confidenceSuffix = gate.failOnConfidence === undefined
      ? ""
      : ` with confidence >= ${formatConfidence(gate.failOnConfidence)}`;
    if (count > 0) reasons.push(`${count} finding${count === 1 ? "" : "s"} at or above ${failOn} severity${confidenceSuffix}`);
  }
  const delta = result.summary.deltaFromBaseline;
  if (gate.failOnRegression && delta) {
    const regressionReasons: string[] = [];
    if (delta.totalDelta > 0) regressionReasons.push(`${formatDelta(delta.totalDelta)} total issues`);
    if (delta.severityRegressions > 0) regressionReasons.push(`${delta.severityRegressions} severity regression${delta.severityRegressions === 1 ? "" : "s"}`);
    const ruleRegressions = Object.entries(delta.byRule ?? {}).filter(([, entry]) => entry.delta > 0);
    if (ruleRegressions.length > 0) regressionReasons.push(`${ruleRegressions.length} rule count regression${ruleRegressions.length === 1 ? "" : "s"}`);
    if (regressionReasons.length > 0) reasons.push(`regression gate detected ${regressionReasons.join(", ")}`);
  }
  if (reasons.length === 0) return `Scanner exited with status ${gate.scanStatus ?? 1}.`;
  return `${capitalize(reasons.join("; "))}.`;
}

function renderWarnings(lines: string[], result: ScanResult): void {
  const warnings = result.summary.warnings ?? [];
  if (warnings.length === 0) return;
  lines.push("", "### Warnings", "");
  for (const warning of warnings.slice(0, 5)) {
    lines.push(`- ${warning}`);
  }
  if (warnings.length > 5) {
    lines.push("", `_...and ${warnings.length - 5} more warning(s)._`);
  }
}

function renderFilterStats(lines: string[], result: ScanResult): void {
  const filterStats = formatFilterStats(result.summary.filterStats);
  if (!filterStats) return;
  lines.push("", "### Filters", "", filterStats);
}

function renderReports(lines: string[], reports: StepSummaryOptions["reports"]): void {
  if (!reports) return;
  const entries: string[] = [];
  if (reports.reportPath) entries.push(`Report (${reports.format ?? "configured format"}): \`${reports.reportPath}\``);
  if (reports.jsonPath) entries.push(`Canonical JSON: \`${reports.jsonPath}\``);
  if (reports.jsonArtifactName) entries.push(`JSON artifact: \`${reports.jsonArtifactName}\``);
  if (entries.length === 0) return;
  lines.push("", "### Reports and Artifacts", "", ...entries.map((entry) => `- ${entry}`));
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

function countAtOrAboveSeverity(result: ScanResult, minimum: Severity, minimumConfidence: number | undefined): number {
  return result.issues.filter((issue) => (
    severityRank(issue.severity) >= severityRank(minimum)
    && (minimumConfidence === undefined || issue.confidence >= minimumConfidence)
  )).length;
}

function parseSeverity(value: string | undefined): Severity | undefined {
  if (value === "info" || value === "low" || value === "medium" || value === "high") return value;
  return undefined;
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

function formatConfidence(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function topIssues(issues: DebtIssue[], limit: number): DebtIssue[] {
  return [...issues]
    .sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) return severityDelta;
      return right.confidence - left.confidence;
    })
    .slice(0, limit);
}

function severityRank(severity: Severity): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}
