import { buildFixTargets, groupIssuesByFile, summarizeIssues } from "../core/issueAggregates.js";
import type { DebtIssue, ScanResult, Severity } from "../core/types.js";
import { formatFilterStats } from "./filterStats.js";
import { escapeMarkdownTableCell, normalizeMarkdownText } from "./markdownEscape.js";
import { getReviewPrompt } from "./ruleGuidance.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

export interface PrCommentOptions {
  sourceUrlBase?: string;
  deltaOnly?: boolean;
  maxFindings?: number;
  maxBytes?: number;
  artifactLink?: string;
}

export function renderPrComment(result: ScanResult, options: PrCommentOptions = {}): string {
  if (options.maxBytes && options.maxBytes > 0) {
    return renderPrCommentWithinByteLimit(result, options);
  }
  const detailIssues = limitIssuesForComment(result.issues, options.maxFindings);
  return renderPrCommentBody(result, options, detailIssues, findingCapReason(options.maxFindings, result.issues.length, detailIssues.length));
}

function renderPrCommentWithinByteLimit(result: ScanResult, options: PrCommentOptions): string {
  const maxFindings = Math.min(result.issues.length, options.maxFindings ?? result.issues.length);
  for (let count = maxFindings; count >= 0; count -= 1) {
    const detailIssues = limitIssuesForComment(result.issues, count);
    const report = renderPrCommentBody(result, options, detailIssues, capReasonForByteLimitedRender(options, result.issues.length, maxFindings, count));
    if (byteLength(report) <= (options.maxBytes ?? Infinity)) {
      return report;
    }
  }
  return renderMinimalPrComment(result, options, byteCapReason(options.maxBytes));
}

function renderPrCommentBody(
  result: ScanResult,
  options: PrCommentOptions,
  detailIssues: DebtIssue[],
  omissionReason: string | undefined,
): string {
  const lines: string[] = [];
  lines.push("<!-- debtlens-report -->");
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
  const delta = result.summary.deltaFromBaseline;
  if (delta) {
    lines.push("");
    lines.push(`Delta: ${formatSigned(delta.totalDelta)} total, ${delta.new} new, ${delta.resolved} resolved, ${delta.changed} changed, ${delta.severityRegressions} severity regression(s).`);
  }

  renderSuppressionAudit(lines, result);

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  renderHotspots(lines, result);
  renderFixTargets(lines, result);
  renderOmittedSummary(lines, result.issues, detailIssues, options, omissionReason);
  if (detailIssues.length === 0) {
    lines.push("");
    lines.push("Detailed annotations are omitted from this comment. Use the full report artifact for every finding.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push("### Grouped annotations");
  if (options.deltaOnly && delta) {
    lines.push("");
    lines.push(`Showing findings not covered by the compared baseline. Changed findings are counted above.`);
  }

  for (const [file, issues] of groupIssuesByFile(detailIssues)) {
    lines.push("");
    lines.push(`<details><summary><code>${escapeHtml(file)}</code> - ${issues.length} finding${issues.length === 1 ? "" : "s"}</summary>`);
    lines.push("");

    for (const issue of issues) {
      const location = renderLocation(issue, options.sourceUrlBase);
      lines.push(`- **${capitalize(issue.severity)}** ${normalizeMarkdownText(issue.ruleName)} (\`${issue.ruleId}\`) at ${location}: ${normalizeMarkdownText(issue.message)}`);
      lines.push(`  - Confidence: **${Math.round(issue.confidence * 100)}%**`);

      if (issue.evidence?.length) {
        lines.push(`  - Evidence: ${issue.evidence.map(normalizeMarkdownText).join("; ")}`);
      }

      if (issue.suggestion) {
        lines.push(`  - Suggestion: ${normalizeMarkdownText(issue.suggestion)}`);
      }
      const reviewPrompt = getReviewPrompt(issue.ruleId);
      if (reviewPrompt) {
        lines.push(`  - Review prompt: ${normalizeMarkdownText(reviewPrompt)}`);
      }
    }
    lines.push("");
    lines.push("</details>");
  }

  return `${lines.join("\n")}\n`;
}

function renderHotspots(lines: string[], result: ScanResult): void {
  const hotspots = result.summary.hotspots?.ranking ?? [];
  if (hotspots.length === 0) return;

  lines.push("");
  lines.push("### Git churn hotspots");
  lines.push("");
  lines.push(`Optional git-derived ranking from ${formatHotspotWindow(result.summary.hotspots?.window)}.`);
  for (const hotspot of hotspots.slice(0, 5)) {
    const topRules = hotspot.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
    lines.push(`- \`${hotspot.file}\` - score ${hotspot.score}, ${hotspot.churn.commits} commit${hotspot.churn.commits === 1 ? "" : "s"}, ${hotspot.churn.changedLines} changed line${hotspot.churn.changedLines === 1 ? "" : "s"}: ${hotspot.reasons.join("; ")}. Top rules: ${topRules}.`);
  }
}

function formatHotspotWindow(window: NonNullable<ScanResult["summary"]["hotspots"]>["window"] | undefined): string {
  if (!window) return "the configured git window";
  if (window.range) return `git range \`${window.range}\``;
  if (window.days) return `the last ${window.days} day${window.days === 1 ? "" : "s"}`;
  return "the configured git window";
}

function renderFixTargets(lines: string[], result: ScanResult): void {
  const targets = buildFixTargets(result.issues, {
    duplicateClusters: result.summary.duplicateClusters,
    limit: 5,
  });
  if (targets.length === 0) return;

  lines.push("");
  lines.push("### Fix these first");
  lines.push("");
  for (const target of targets) {
    const topRules = target.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
    lines.push(`- \`${target.file}\` - ${target.totalIssues} finding${target.totalIssues === 1 ? "" : "s"}, ${target.distinctRules} rule${target.distinctRules === 1 ? "" : "s"}: ${target.reasons.join("; ")}. Top rules: ${topRules}.`);
  }
}

function renderOmittedSummary(
  lines: string[],
  allIssues: DebtIssue[],
  detailIssues: DebtIssue[],
  options: PrCommentOptions,
  omissionReason: string | undefined,
): void {
  const omitted = omittedIssues(allIssues, detailIssues);
  if (omitted.length === 0) return;

  const summary = summarizeIssues(omitted);
  const topRules = Object.entries(summary.byRule)
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) return countDelta;
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 5)
    .map(([ruleId, count]) => `${ruleId} (${count})`)
    .join(", ");
  const topFiles = groupIssuesByFile(omitted)
    .slice(0, 5)
    .map(([file, issues]) => `${file} (${issues.length})`)
    .join(", ");
  const capReason = omissionReason ?? "the configured comment limits";

  lines.push("");
  lines.push("### Omitted finding summary");
  lines.push("");
  lines.push(`${omitted.length} finding${omitted.length === 1 ? "" : "s"} omitted from detailed annotations to stay under ${capReason}.`);
  lines.push(`Severity: ${formatSeverityCounts(summary.bySeverity)}.`);
  if (topRules) lines.push(`Top rules: ${topRules}.`);
  if (topFiles) lines.push(`Top files: ${topFiles}.`);
  if (options.artifactLink) {
    lines.push(`Full details: ${options.artifactLink}.`);
  } else {
    lines.push("Full details remain available in the canonical JSON or Markdown artifact.");
  }
}

function renderMinimalPrComment(result: ScanResult, options: PrCommentOptions, omissionReason: string): string {
  const lines = [
    "<!-- debtlens-report -->",
    "## DebtLens findings",
    "",
    `Issues: ${result.summary.totalIssues} | high ${result.summary.bySeverity.high} | medium ${result.summary.bySeverity.medium} | low ${result.summary.bySeverity.low} | info ${result.summary.bySeverity.info}`,
    "",
    `Detailed annotations are omitted from this comment to stay under ${omissionReason}.`,
    options.artifactLink ? `Full details: ${options.artifactLink}.` : "Full details remain available in the canonical JSON or Markdown artifact.",
  ];
  const report = `${lines.join("\n")}\n`;
  if (!options.maxBytes || byteLength(report) <= options.maxBytes) return report;
  return truncateToByteLimit(report, options.maxBytes);
}

function renderSuppressionAudit(lines: string[], result: ScanResult): void {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return;

  lines.push("");
  lines.push("### Suppression audit");
  lines.push("");
  lines.push(formatSuppressionAuditSummary(summarizeSuppressionDirectives(directives)));
  lines.push("");
  lines.push("| Status | Kind | Location | Rule | Hidden findings | Reason | Recommended action |");
  lines.push("| --- | --- | --- | --- | ---: | --- | --- |");
  for (const directive of directives) {
    lines.push([
      directive.status,
      formatSuppressionKind(directive.kind),
      `\`${escapeMarkdownTableCell(formatSuppressionDirectiveLine(directive))}\``,
      `\`${escapeMarkdownTableCell(directive.ruleId)}\``,
      String(directive.suppressedIssueCount),
      escapeMarkdownTableCell(normalizeMarkdownText(directive.reason)),
      escapeMarkdownTableCell(normalizeMarkdownText(directive.recommendedAction)),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
}

function renderLocation(issue: DebtIssue, sourceUrlBase: string | undefined): string {
  const line = issue.location?.startLine;
  const label = line ? `${issue.file}:${line}` : issue.file;
  if (!line || !sourceUrlBase) return `\`${label}\``;
  return `[\`${label}\`](${sourceUrlBase}/${encodePath(issue.file)}#L${line})`;
}

function limitIssuesForComment(issues: DebtIssue[], maxFindings: number | undefined): DebtIssue[] {
  if (maxFindings === undefined || maxFindings >= issues.length) return [...issues];
  return [...issues].sort(compareIssuesForComment).slice(0, Math.max(0, maxFindings));
}

function capReasonForByteLimitedRender(
  options: PrCommentOptions,
  totalIssues: number,
  maxFindings: number,
  detailCount: number,
): string | undefined {
  const findingReason = findingCapReason(options.maxFindings, totalIssues, detailCount);
  if (detailCount === maxFindings && findingReason) return findingReason;
  if (detailCount < totalIssues) return byteCapReason(options.maxBytes);
  return undefined;
}

function findingCapReason(maxFindings: number | undefined, totalIssues: number, detailCount: number): string | undefined {
  if (maxFindings === undefined || detailCount >= totalIssues) return undefined;
  return `the configured ${maxFindings}-finding detail cap`;
}

function byteCapReason(maxBytes: number | undefined): string {
  return maxBytes ? `the configured ${maxBytes}-byte comment cap` : "the configured comment byte cap";
}

function compareIssuesForComment(left: DebtIssue, right: DebtIssue): number {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) return severityDelta;
  const confidenceDelta = right.confidence - left.confidence;
  if (confidenceDelta !== 0) return confidenceDelta;
  const fileDelta = left.file.localeCompare(right.file);
  if (fileDelta !== 0) return fileDelta;
  return (left.location?.startLine ?? 0) - (right.location?.startLine ?? 0);
}

function omittedIssues(allIssues: DebtIssue[], detailIssues: DebtIssue[]): DebtIssue[] {
  const detailOccurrences = new Set(detailIssues);
  return allIssues.filter((issue) => !detailOccurrences.has(issue));
}

function formatSeverityCounts(bySeverity: Record<Severity, number>): string {
  return `high ${bySeverity.high}, medium ${bySeverity.medium}, low ${bySeverity.low}, info ${bySeverity.info}`;
}

function severityRank(severity: Severity): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateToByteLimit(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const suffix = "\n\n_Comment truncated to fit the configured byte cap._\n";
  const suffixBytes = encoder.encode(suffix);
  const valueBytes = encoder.encode(value);
  if (maxBytes <= suffixBytes.length) {
    return truncateByCodePoint(value, maxBytes);
  }
  const prefix = truncateByCodePoint(decoder.decode(valueBytes.slice(0, maxBytes - suffixBytes.length)), maxBytes - suffixBytes.length).replace(/\s+$/, "");
  return fitToByteLimit(`${prefix}${suffix}`, maxBytes);
}

function truncateByCodePoint(value: string, maxBytes: number): string {
  let output = "";
  for (const character of value) {
    if (byteLength(`${output}${character}`) > maxBytes) break;
    output += character;
  }
  return output;
}

function fitToByteLimit(value: string, maxBytes: number): string {
  let output = value;
  while (byteLength(output) > maxBytes && output.length > 0) {
    output = output.slice(0, -1);
  }
  return output;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
