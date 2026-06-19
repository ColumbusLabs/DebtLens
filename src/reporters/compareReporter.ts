import type { ScanTrendComparison } from "../core/scanComparison.js";
import { escapeMarkdownTableCell } from "./markdownEscape.js";

export type CompareReportFormat = "terminal" | "markdown" | "json";

export function renderCompareReport(comparison: ScanTrendComparison, format: CompareReportFormat): string {
  if (format === "json") return `${JSON.stringify(comparison, null, 2)}\n`;
  if (format === "markdown") return renderCompareMarkdown(comparison);
  return renderCompareTerminal(comparison);
}

function renderCompareTerminal(comparison: ScanTrendComparison): string {
  const lines = [
    "DebtLens Compare",
    `Previous issues: ${comparison.previous.totalIssues}`,
    `Current issues: ${comparison.current.totalIssues}`,
    `Total delta: ${formatSigned(comparison.delta.total)}`,
    `New: ${formatMetric(comparison.delta.new)} | Resolved: ${formatMetric(comparison.delta.resolved)} | Changed: ${formatMetric(comparison.delta.changed)} | Severity regressions: ${formatMetric(comparison.delta.severityRegressions)}`,
    "",
    "Severity delta:",
  ];

  for (const entry of comparison.delta.bySeverity) {
    lines.push(`  ${capitalize(entry.severity)}: ${entry.previous} -> ${entry.current} (${formatSigned(entry.delta)})`);
  }

  lines.push("", "Rule delta:");
  const changedRules = comparison.delta.byRule.filter((entry) => entry.delta !== 0);
  if (changedRules.length === 0) {
    lines.push("  No rule count changes.");
  } else {
    for (const entry of changedRules.slice(0, 10)) {
      lines.push(`  ${entry.ruleId}: ${entry.previous} -> ${entry.current} (${formatSigned(entry.delta)})`);
    }
  }

  lines.push("", "Top new files:");
  if (comparison.accuracy.issueIdentity === "unavailable") {
    lines.push("  Unavailable for summary-only comparison.");
  } else if (comparison.topNewFiles.length === 0) {
    lines.push("  No new files with debt.");
  } else {
    for (const file of comparison.topNewFiles) {
      const rules = Object.entries(file.byRule).map(([ruleId, count]) => `${ruleId} ${count}`).join(", ");
      lines.push(`  ${file.file}: ${file.count} new (${rules})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderCompareMarkdown(comparison: ScanTrendComparison): string {
  const lines = [
    "# DebtLens Compare",
    "",
    `Previous issues: **${comparison.previous.totalIssues}**`,
    `Current issues: **${comparison.current.totalIssues}**`,
    `Total delta: **${formatSigned(comparison.delta.total)}**`,
    "",
    `New: **${formatMetric(comparison.delta.new)}** · Resolved: **${formatMetric(comparison.delta.resolved)}** · Changed: **${formatMetric(comparison.delta.changed)}** · Severity regressions: **${formatMetric(comparison.delta.severityRegressions)}**`,
    "",
    "## Severity Delta",
    "",
    "| Severity | Previous | Current | Delta |",
    "| --- | ---: | ---: | ---: |",
  ];

  for (const entry of comparison.delta.bySeverity) {
    lines.push(`| ${capitalize(entry.severity)} | ${entry.previous} | ${entry.current} | ${formatSigned(entry.delta)} |`);
  }

  lines.push("", "## Rule Delta", "");
  const changedRules = comparison.delta.byRule.filter((entry) => entry.delta !== 0);
  if (changedRules.length === 0) {
    lines.push("No rule count changes.");
  } else {
    lines.push("| Rule | Previous | Current | Delta |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const entry of changedRules.slice(0, 20)) {
      lines.push(`| \`${escapeMarkdownTableCell(entry.ruleId)}\` | ${entry.previous} | ${entry.current} | ${formatSigned(entry.delta)} |`);
    }
  }

  lines.push("", "## Top New Files", "");
  if (comparison.accuracy.issueIdentity === "unavailable") {
    lines.push("Unavailable for summary-only comparison.");
  } else if (comparison.topNewFiles.length === 0) {
    lines.push("No new files with debt.");
  } else {
    lines.push("| File | New issues | Rules |");
    lines.push("| --- | ---: | --- |");
    for (const file of comparison.topNewFiles) {
      const rules = Object.entries(file.byRule).map(([ruleId, count]) => `${ruleId} (${count})`).join(", ");
      lines.push(`| \`${escapeMarkdownTableCell(file.file)}\` | ${file.count} | ${escapeMarkdownTableCell(rules)} |`);
    }
  }

  if (comparison.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    for (const warning of comparison.warnings) {
      lines.push(`- ${escapeMarkdownTableCell(warning)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatMetric(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
