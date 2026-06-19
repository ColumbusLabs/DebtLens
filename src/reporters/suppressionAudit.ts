import type { SuppressionDirectiveAudit } from "../core/types.js";

export interface SuppressionDirectiveSummary {
  total: number;
  used: number;
  unused: number;
  notEvaluated: number;
  fileWide: number;
  nextLine: number;
  suppressedIssues: number;
}

export function summarizeSuppressionDirectives(
  directives: readonly SuppressionDirectiveAudit[] | undefined,
): SuppressionDirectiveSummary {
  const summary: SuppressionDirectiveSummary = {
    total: 0,
    used: 0,
    unused: 0,
    notEvaluated: 0,
    fileWide: 0,
    nextLine: 0,
    suppressedIssues: 0,
  };
  for (const directive of directives ?? []) {
    summary.total += 1;
    if (directive.status === "used") summary.used += 1;
    if (directive.status === "unused") summary.unused += 1;
    if (directive.status === "not-evaluated") summary.notEvaluated += 1;
    if (directive.kind === "file") summary.fileWide += 1;
    if (directive.kind === "next-line") summary.nextLine += 1;
    summary.suppressedIssues += directive.suppressedIssueCount;
  }
  return summary;
}

export function formatSuppressionAuditSummary(summary: SuppressionDirectiveSummary): string {
  return [
    `${summary.total} directive${plural(summary.total)}`,
    `${summary.unused} unused`,
    `${summary.notEvaluated} not evaluated`,
    `${summary.fileWide} file-wide`,
    `${summary.nextLine} next-line`,
    `${summary.suppressedIssues} hidden finding${plural(summary.suppressedIssues)}`,
  ].join(" | ");
}

export function formatSuppressionKind(kind: SuppressionDirectiveAudit["kind"]): string {
  return kind === "file" ? "file-wide" : "next-line";
}

export function formatSuppressionDirectiveLine(directive: SuppressionDirectiveAudit): string {
  return `${directive.file}:${directive.directiveLine}`;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
