import { buildDebtHeatmap, buildFixTargets } from "../core/issueAggregates.js";
import type { ScanResult, Severity } from "../core/types.js";
import { renderPayoffSectionHtml } from "./payoffSection.js";
import { formatFilterStats } from "./filterStats.js";
import {
  formatSuppressionAuditSummary,
  formatSuppressionDirectiveLine,
  formatSuppressionKind,
  summarizeSuppressionDirectives,
} from "./suppressionAudit.js";

const severityOrder: Severity[] = ["high", "medium", "low", "info"];

export function renderHtml(result: ScanResult): string {
  const filterStats = formatFilterStats(result.summary.filterStats);
  const heatmap = buildDebtHeatmap(result.issues, 10);
  const fixTargets = buildFixTargets(result.issues, {
    duplicateClusters: result.summary.duplicateClusters,
    limit: 5,
  });
  const hotspots = result.summary.hotspots?.ranking ?? [];
  const ownership = result.summary.ownership;
  const findings = result.issues.map((issue) => {
    const location = issue.location ? `${issue.file}:${issue.location.startLine}` : issue.file;
    return `<tr><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.ruleName)}</td><td><code>${escapeHtml(location)}</code></td><td>${escapeHtml(issue.message)}</td><td>${Math.round(issue.confidence * 100)}%</td></tr>`;
  }).join("\n");

  const correlations = (result.summary.correlations ?? []).map((entry) => (
    `<tr><td><code>${escapeHtml(entry.file)}</code></td><td>${entry.totalIssues}</td><td>${escapeHtml(entry.rules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", "))}</td></tr>`
  )).join("\n");
  const suppressionAudit = renderSuppressionAudit(result);
  const payoffSection = renderPayoffSectionHtml(result.issues);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DebtLens Report</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172026; background: #f7f8fa; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    h1, h2 { margin: 0 0 16px; }
    p { margin: 0 0 20px; color: #46515c; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 28px; background: #fff; border: 1px solid #d8dee4; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e6ebef; vertical-align: top; }
    th { background: #eef2f5; font-size: 13px; text-transform: uppercase; letter-spacing: .02em; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 20px 0 28px; }
    .metric { background: #fff; border: 1px solid #d8dee4; padding: 14px; }
    .metric strong { display: block; font-size: 28px; line-height: 1; }
    .empty { background: #fff; border: 1px solid #d8dee4; padding: 18px; }
  </style>
</head>
<body>
<main>
  <h1>DebtLens Report</h1>
  <p>Scanned ${result.summary.filesScanned} files with ${result.summary.rulesRun} rules in ${result.summary.elapsedMs}ms.${filterStats ? ` Filtered: ${escapeHtml(filterStats)}.` : ""}</p>
  <section class="summary">
    <div class="metric"><span>Total</span><strong>${result.summary.totalIssues}</strong></div>
    ${severityOrder.map((severity) => `<div class="metric"><span>${capitalize(severity)}</span><strong>${result.summary.bySeverity[severity]}</strong></div>`).join("\n    ")}
  </section>
  ${suppressionAudit}
  ${hotspots.length ? `<h2>Git Churn Hotspots</h2>
  <p>Optional git-derived ranking from ${escapeHtml(formatHotspotWindow(result.summary.hotspots?.window))}. Score combines current findings with recent commits and changed lines.</p>
  <table>
    <thead><tr><th>File</th><th>Score</th><th>Churn</th><th>Why</th><th>Top rules</th></tr></thead>
    <tbody>
${hotspots.map((hotspot) => `<tr><td><code>${escapeHtml(hotspot.file)}</code></td><td>${hotspot.score}</td><td>${hotspot.churn.commits} commit${hotspot.churn.commits === 1 ? "" : "s"}, ${hotspot.churn.changedLines} changed line${hotspot.churn.changedLines === 1 ? "" : "s"}</td><td>${escapeHtml(hotspot.reasons.join("; "))}</td><td>${escapeHtml(hotspot.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", "))}</td></tr>`).join("\n")}
    </tbody>
  </table>` : ""}
  ${ownership ? `<h2>Ownership Handoffs</h2>
  <p>CODEOWNERS source: <code>${escapeHtml(ownership.codeownersPath)}</code>.</p>
  ${ownership.ownerSummaries.length ? `<table>
    <thead><tr><th>Owner</th><th>Files</th><th>Issues</th><th>Top files</th></tr></thead>
    <tbody>
${ownership.ownerSummaries.map((owner) => `<tr><td>${escapeHtml(owner.owner)}</td><td>${owner.files}</td><td>${owner.totalIssues}</td><td>${escapeHtml(owner.topFiles.map((file) => `${file.file} (${file.totalIssues})`).join(", "))}</td></tr>`).join("\n")}
    </tbody>
  </table>` : ""}
  ${ownership.unownedHotspots.length ? `<h3>Unowned High-Debt Files</h3>
  <table>
    <thead><tr><th>File</th><th>Score</th><th>Why</th><th>Top rules</th></tr></thead>
    <tbody>
${ownership.unownedHotspots.map((target) => `<tr><td><code>${escapeHtml(target.file)}</code></td><td>${target.score}</td><td>${escapeHtml(target.reasons.join("; "))}</td><td>${escapeHtml(target.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", "))}</td></tr>`).join("\n")}
    </tbody>
  </table>` : ""}` : ""}
  ${fixTargets.length ? `<h2>Fix These First</h2>
  <table>
    <thead><tr><th>File</th><th>Issues</th><th>Why</th><th>Top rules</th></tr></thead>
    <tbody>
${fixTargets.map((target) => `<tr><td><code>${escapeHtml(target.file)}</code></td><td>${target.totalIssues}</td><td>${escapeHtml(target.reasons.join("; "))}</td><td>${escapeHtml(target.topRules.map((rule) => `${rule.ruleId} (${rule.count})`).join(", "))}</td></tr>`).join("\n")}
    </tbody>
  </table>` : ""}
  <h2>Findings</h2>
  ${result.issues.length === 0 ? `<div class="empty">No maintainability debt found at the configured severity level.</div>` : `<table>
    <thead><tr><th>Severity</th><th>Rule</th><th>Location</th><th>Message</th><th>Confidence</th></tr></thead>
    <tbody>
${findings}
    </tbody>
  </table>`}
  ${heatmap.length ? `<h2>Debt Heatmap</h2>
  <table>
    <thead><tr><th>File</th><th>Issues</th><th>Rules</th><th>High</th><th>Medium</th><th>Low</th><th>Info</th></tr></thead>
    <tbody>
${heatmap.map((entry) => `<tr><td><code>${escapeHtml(entry.file)}</code></td><td>${entry.totalIssues}</td><td>${entry.distinctRules}</td><td>${entry.bySeverity.high}</td><td>${entry.bySeverity.medium}</td><td>${entry.bySeverity.low}</td><td>${entry.bySeverity.info}</td></tr>`).join("\n")}
    </tbody>
  </table>` : ""}
  ${payoffSection}
  ${correlations ? `<h2>Rule Correlations</h2>
  <table>
    <thead><tr><th>File</th><th>Issues</th><th>Rules</th></tr></thead>
    <tbody>
${correlations}
    </tbody>
  </table>` : ""}
</main>
</body>
</html>
`;
}

function formatHotspotWindow(window: NonNullable<ScanResult["summary"]["hotspots"]>["window"] | undefined): string {
  if (!window) return "the configured git window";
  if (window.range) return `git range ${window.range}`;
  if (window.days) return `the last ${window.days} day${window.days === 1 ? "" : "s"}`;
  return "the configured git window";
}

function renderSuppressionAudit(result: ScanResult): string {
  const directives = result.suppressionDirectives ?? [];
  if (directives.length === 0) return "";

  const rows = directives.map((directive) => (
    `<tr><td>${escapeHtml(directive.status)}</td><td>${escapeHtml(formatSuppressionKind(directive.kind))}</td><td><code>${escapeHtml(formatSuppressionDirectiveLine(directive))}</code></td><td><code>${escapeHtml(directive.ruleId)}</code></td><td>${directive.suppressedIssueCount}</td><td>${escapeHtml(directive.reason)}</td><td>${escapeHtml(directive.recommendedAction)}</td></tr>`
  )).join("\n");

  return `<h2>Suppression Audit</h2>
  <p>${escapeHtml(formatSuppressionAuditSummary(summarizeSuppressionDirectives(directives)))}</p>
  <table>
    <thead><tr><th>Status</th><th>Kind</th><th>Location</th><th>Rule</th><th>Hidden findings</th><th>Reason</th><th>Recommended action</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
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
