import { groupIssuesByRule, summarizeIssues } from "./issueAggregates.js";
import { buildOwnershipSummary, loadCodeowners } from "./ownership.js";
import { sortIssuesByPayoff } from "./priority.js";
import type { DebtIssue, ScanOwnershipSummary, ScanResult, Severity } from "./types.js";

export interface OwnershipScorecardEntry {
  owner: string;
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  topRules: Array<{ ruleId: string; count: number }>;
  topFiles: Array<{ file: string; totalIssues: number; score: number }>;
  payoffWeightedDebt?: number;
  trend?: "up" | "down" | "flat";
}

export interface OwnershipReport {
  codeownersPath: string;
  owners: OwnershipScorecardEntry[];
  unowned: OwnershipScorecardEntry;
  leaderboardByCount: OwnershipScorecardEntry[];
  leaderboardByPayoff: OwnershipScorecardEntry[];
}

export function buildOwnershipReport(input: {
  result: ScanResult;
  cwd: string;
  codeownersPath?: string;
  ownerFilter?: string;
  historyTotalsByOwner?: Record<string, number[]>;
}): OwnershipReport | undefined {
  const codeowners = loadCodeowners(input.cwd, input.codeownersPath);
  if (!codeowners) return undefined;

  const ownership = buildOwnershipSummary({
    issues: input.result.issues,
    codeowners,
  });
  if (!ownership) return undefined;

  const owners = ownership.ownerSummaries.map((owner) => toScorecard(owner, input.result.issues, input.historyTotalsByOwner?.[owner.owner]));
  const unownedIssues = input.result.issues.filter((issue) => {
    const file = ownership.files.find((entry) => entry.file === issue.file);
    return !file || file.owners.length === 0;
  });
  const unowned = toScorecard({
    owner: "unowned",
    totalIssues: unownedIssues.length,
    bySeverity: summarizeIssues(unownedIssues).bySeverity,
    topFiles: [],
  }, unownedIssues);

  const filteredOwners = input.ownerFilter
    ? owners.filter((owner) => owner.owner.includes(input.ownerFilter!))
    : owners;

  return {
    codeownersPath: ownership.codeownersPath,
    owners: filteredOwners,
    unowned,
    leaderboardByCount: [...filteredOwners].sort((left, right) => right.totalIssues - left.totalIssues || left.owner.localeCompare(right.owner)),
    leaderboardByPayoff: [...filteredOwners].sort((left, right) => (right.payoffWeightedDebt ?? 0) - (left.payoffWeightedDebt ?? 0) || left.owner.localeCompare(right.owner)),
  };
}

function toScorecard(
  owner: {
    owner: string;
    totalIssues: number;
    bySeverity: Record<Severity, number>;
    topFiles: Array<{ file: string; totalIssues: number; score: number }>;
  },
  issues: DebtIssue[],
  history?: number[],
): OwnershipScorecardEntry {
  const ownerIssues = issues.filter((issue) => owner.topFiles.some((file) => file.file === issue.file) || owner.owner === "unowned");
  const topRules = groupIssuesByRule(ownerIssues)
    .map(([ruleId, ruleIssues]) => ({ ruleId, count: ruleIssues.length }))
    .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId))
    .slice(0, 5);
  const payoffWeightedDebt = sortIssuesByPayoff(ownerIssues).reduce((total, issue) => total + (issue.payoffScore ?? 0), 0);
  return {
    owner: owner.owner,
    totalIssues: owner.totalIssues,
    bySeverity: owner.bySeverity,
    topRules,
    topFiles: owner.topFiles,
    payoffWeightedDebt: Number(payoffWeightedDebt.toFixed(2)),
    trend: trendFromHistory(history),
  };
}

function trendFromHistory(history?: number[]): "up" | "down" | "flat" | undefined {
  if (!history || history.length < 2) return undefined;
  const previous = history[history.length - 2] ?? 0;
  const current = history[history.length - 1] ?? 0;
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

export function renderOwnershipReportTerminal(report: OwnershipReport): string {
  const lines = [
    "Ownership scorecard",
    `CODEOWNERS: ${report.codeownersPath}`,
    "",
    "Leaderboard (count)",
  ];
  for (const owner of report.leaderboardByCount.slice(0, 10)) {
    lines.push(`  ${owner.owner}: ${owner.totalIssues} issues (${owner.bySeverity.high} high)${owner.trend ? ` ${arrow(owner.trend)}` : ""}`);
  }
  lines.push("", `Unowned bucket: ${report.unowned.totalIssues} issues`);
  return `${lines.join("\n")}\n`;
}

function arrow(trend: "up" | "down" | "flat"): string {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "→";
}
