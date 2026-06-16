import { groupIssuesByFile } from "../core/issueAggregates.js";
import type { DebtIssue, ScanResult } from "../core/types.js";
import { formatFilterStats } from "./filterStats.js";
import { normalizeMarkdownText } from "./markdownEscape.js";
import { getReviewPrompt } from "./ruleGuidance.js";

export interface PrCommentOptions {
  sourceUrlBase?: string;
  deltaOnly?: boolean;
}

export function renderPrComment(result: ScanResult, options: PrCommentOptions = {}): string {
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

  if (result.issues.length === 0) {
    lines.push("");
    lines.push("No maintainability debt found at the configured severity level.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push("### Grouped annotations");
  if (options.deltaOnly && delta) {
    lines.push("");
    lines.push(`Showing findings not covered by the compared baseline. Changed findings are counted above.`);
  }

  for (const [file, issues] of groupIssuesByFile(result.issues)) {
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

function renderLocation(issue: DebtIssue, sourceUrlBase: string | undefined): string {
  const line = issue.location?.startLine;
  const label = line ? `${issue.file}:${line}` : issue.file;
  if (!line || !sourceUrlBase) return `\`${label}\``;
  return `[\`${label}\`](${sourceUrlBase}/${encodePath(issue.file)}#L${line})`;
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
