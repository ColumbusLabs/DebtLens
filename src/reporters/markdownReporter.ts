import { buildDebtHeatmap, buildFixTargets } from "../core/issueAggregates.js";
import type { ScanResult, Severity } from "../core/types.js";
import { formatFilterStats } from "./filterStats.js";
import { escapeMarkdownTableCell } from "./markdownEscape.js";
import { getReviewPrompt } from "./ruleGuidance.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];

export interface MarkdownOptions {
  heatmapLimit?: number;
}

export function renderMarkdown(result: ScanResult, options: MarkdownOptions = {}): string {
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
  const filterStats = formatFilterStats(result.summary.filterStats);
  if (filterStats) {
    lines.push(`- Filtered: **${filterStats}**`);
  }

  renderSuppressionAudit(lines, result);

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  renderHotspots(lines, result);
  renderOwnership(lines, result);
  renderFixTargets(lines, result);

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
      const reviewPrompt = getReviewPrompt(issue.ruleId);
      if (reviewPrompt) {
        lines.push("");
        lines.push(`Review prompt: ${reviewPrompt}`);
      }
      lines.push("");
    }
  }

  if (result.summary.correlations?.length) {
    lines.push("");
    lines.push("## Rule correlations");
    lines.push("");
    lines.push("| File | Rules | Issues |");
    lines.push("| --- | --- | ---: |");
    for (const entry of result.summary.correlations) {
      const rules = entry.rules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
      lines.push(`| \`${escapeMarkdownTableCell(entry.file)}\` | ${escapeMarkdownTableCell(rules)} | ${entry.totalIssues} |`);
    }
  }

  if (result.summary.duplicateClusters?.length) {
    lines.push("");
    lines.push("## Duplicate logic clusters");
    lines.push("");
    lines.push("| Cluster | Findings | Locations |");
    lines.push("| --- | ---: | --- |");
    for (const cluster of result.summary.duplicateClusters) {
      const locations = cluster.locations
        .map((location) => `${location.file}:${location.startLine}${location.endLine ? `-${location.endLine}` : ""}`)
        .join(", ");
      lines.push(`| \`${escapeMarkdownTableCell(cluster.clusterId)}\` | ${cluster.issueCount} | ${escapeMarkdownTableCell(locations)} |`);
    }
  }

  if (options.heatmapLimit && options.heatmapLimit > 0) {
    const heatmap = buildDebtHeatmap(result.issues, options.heatmapLimit);
    if (heatmap.length) {
      lines.push("");
      lines.push("## Debt heatmap");
      lines.push("");
      lines.push("| File | Issues | Rules | High | Medium | Low | Info |");
      lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const entry of heatmap) {
        lines.push(`| \`${escapeMarkdownTableCell(entry.file)}\` | ${entry.totalIssues} | ${entry.distinctRules} | ${entry.bySeverity.high} | ${entry.bySeverity.medium} | ${entry.bySeverity.low} | ${entry.bySeverity.info} |`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderHotspots(lines: string[], result: ScanResult): void {
  const hotspots = result.summary.hotspots?.ranking ?? [];
  if (hotspots.length === 0) return;

  lines.push("");
  lines.push("## Git churn hotspots");
  lines.push("");
  lines.push(`Optional git-derived ranking from ${formatHotspotWindow(result.summary.hotspots?.window)}. Score combines current findings with recent commits and changed lines.`);
  lines.push("");
  lines.push("| File | Score | Churn | Why | Top rules |");
  lines.push("| --- | ---: | --- | --- | --- |");
  for (const hotspot of hotspots) {
    const churn = `${hotspot.churn.commits} commit${hotspot.churn.commits === 1 ? "" : "s"}, ${hotspot.churn.changedLines} changed line${hotspot.churn.changedLines === 1 ? "" : "s"}`;
    const topRules = hotspot.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
    lines.push(`| \`${escapeMarkdownTableCell(hotspot.file)}\` | ${hotspot.score} | ${escapeMarkdownTableCell(churn)} | ${escapeMarkdownTableCell(hotspot.reasons.join("; "))} | ${escapeMarkdownTableCell(topRules)} |`);
  }
}

function formatHotspotWindow(window: NonNullable<ScanResult["summary"]["hotspots"]>["window"] | undefined): string {
  if (!window) return "the configured git window";
  if (window.range) return `git range \`${window.range}\``;
  if (window.days) return `the last ${window.days} day${window.days === 1 ? "" : "s"}`;
  return "the configured git window";
}

function renderOwnership(lines: string[], result: ScanResult): void {
  const ownership = result.summary.ownership;
  if (!ownership) return;

  lines.push("");
  lines.push("## Ownership handoffs");
  lines.push("");
  lines.push(`CODEOWNERS source: \`${escapeMarkdownTableCell(ownership.codeownersPath)}\`.`);

  if (ownership.ownerSummaries.length) {
    lines.push("");
    lines.push("| Owner | Files | Issues | Top files |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const owner of ownership.ownerSummaries) {
      const topFiles = owner.topFiles.map((file) => `${file.file} (${file.totalIssues})`).join(", ");
      lines.push(`| ${escapeMarkdownTableCell(owner.owner)} | ${owner.files} | ${owner.totalIssues} | ${escapeMarkdownTableCell(topFiles)} |`);
    }
  }

  if (ownership.unownedHotspots.length) {
    lines.push("");
    lines.push("### Unowned high-debt files");
    lines.push("");
    lines.push("| File | Score | Why | Top rules |");
    lines.push("| --- | ---: | --- | --- |");
    for (const target of ownership.unownedHotspots) {
      const topRules = target.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
      lines.push(`| \`${escapeMarkdownTableCell(target.file)}\` | ${target.score} | ${escapeMarkdownTableCell(target.reasons.join("; "))} | ${escapeMarkdownTableCell(topRules)} |`);
    }
  }
}

function renderFixTargets(lines: string[], result: ScanResult): void {
  const targets = buildFixTargets(result.issues, {
    duplicateClusters: result.summary.duplicateClusters,
    limit: 5,
  });
  if (targets.length === 0) return;

  lines.push("");
  lines.push("## Fix these first");
  lines.push("");
  lines.push("| File | Why | Top rules |");
  lines.push("| --- | --- | --- |");
  for (const target of targets) {
    const topRules = target.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", ");
    lines.push(`| \`${escapeMarkdownTableCell(target.file)}\` | ${escapeMarkdownTableCell(target.reasons.join("; "))} | ${escapeMarkdownTableCell(topRules)} |`);
  }
}

function renderSuppressionAudit(lines: string[], result: ScanResult): void {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return;

  const summary = summarizeSuppressionDirectives(directives);
  lines.push("");
  lines.push("## Suppression audit");
  lines.push("");
  lines.push(formatSuppressionAuditSummary(summary));
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
      escapeMarkdownTableCell(directive.reason),
      escapeMarkdownTableCell(directive.recommendedAction),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
