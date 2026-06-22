import { summarizeIssues } from "./issueAggregates.js";
import type { DebtIssue, ScanResult, Severity } from "./types.js";

export interface AreaBudget {
  maxIssues?: number;
  maxHigh?: number;
  maxMedium?: number;
}

export type BudgetConfig = Record<string, AreaBudget>;

export interface AreaBudgetUsage {
  pattern: string;
  issueCount: number;
  bySeverity: Record<Severity, number>;
  maxIssues?: number;
  maxHigh?: number;
  maxMedium?: number;
  headroomIssues?: number;
  headroomHigh?: number;
  headroomMedium?: number;
  breached: boolean;
  breachMessages: string[];
}

export interface BudgetEvaluation {
  areas: AreaBudgetUsage[];
  breached: boolean;
  messages: string[];
}

export function evaluateBudgets(result: ScanResult, budgets: BudgetConfig | undefined): BudgetEvaluation | undefined {
  if (!budgets || Object.keys(budgets).length === 0) return undefined;

  const areas: AreaBudgetUsage[] = [];
  const messages: string[] = [];

  for (const [pattern, budget] of Object.entries(budgets)) {
    const issues = filterIssuesByPattern(result.issues, pattern);
    const summary = summarizeIssues(issues);
    const usage: AreaBudgetUsage = {
      pattern,
      issueCount: summary.totalIssues,
      bySeverity: summary.bySeverity,
      maxIssues: budget.maxIssues,
      maxHigh: budget.maxHigh,
      maxMedium: budget.maxMedium,
      breached: false,
      breachMessages: [],
    };

    if (budget.maxIssues !== undefined) {
      usage.headroomIssues = budget.maxIssues - summary.totalIssues;
      if (summary.totalIssues > budget.maxIssues) {
        usage.breached = true;
        usage.breachMessages.push(`${pattern}: ${summary.totalIssues} issues exceeds budget of ${budget.maxIssues}`);
      }
    }
    if (budget.maxHigh !== undefined) {
      usage.headroomHigh = budget.maxHigh - summary.bySeverity.high;
      if (summary.bySeverity.high > budget.maxHigh) {
        usage.breached = true;
        usage.breachMessages.push(`${pattern}: ${summary.bySeverity.high} high-severity issues exceeds budget of ${budget.maxHigh}`);
      }
    }
    if (budget.maxMedium !== undefined) {
      const mediumPlus = summary.bySeverity.high + summary.bySeverity.medium;
      usage.headroomMedium = budget.maxMedium - mediumPlus;
      if (mediumPlus > budget.maxMedium) {
        usage.breached = true;
        usage.breachMessages.push(`${pattern}: ${mediumPlus} medium-or-higher issues exceeds budget of ${budget.maxMedium}`);
      }
    }

    if (usage.breachMessages.length > 0) {
      messages.push(...usage.breachMessages);
    }
    areas.push(usage);
  }

  areas.sort((left, right) => left.pattern.localeCompare(right.pattern));
  return {
    areas,
    breached: areas.some((area) => area.breached),
    messages,
  };
}

export function renderBudgetReport(evaluation: BudgetEvaluation): string {
  const lines = [
    "Area budget report:",
    "",
    `${"Pattern".padEnd(24)}  ${"Used".padEnd(4)}  ${"Budget".padEnd(12)}  ${"Headroom".padEnd(10)}  Status`,
    `${"-".repeat(24)}  ${"-".repeat(4)}  ${"-".repeat(12)}  ${"-".repeat(10)}  ${"-".repeat(6)}`,
  ];
  for (const area of evaluation.areas) {
    const budgetParts = [
      area.maxIssues !== undefined ? `issues ${area.issueCount}/${area.maxIssues}` : undefined,
      area.maxHigh !== undefined ? `high ${area.bySeverity.high}/${area.maxHigh}` : undefined,
      area.maxMedium !== undefined ? `med+ ${area.bySeverity.high + area.bySeverity.medium}/${area.maxMedium}` : undefined,
    ].filter(Boolean);
    const headroomParts = [
      area.headroomIssues !== undefined ? `issues ${area.headroomIssues}` : undefined,
      area.headroomHigh !== undefined ? `high ${area.headroomHigh}` : undefined,
      area.headroomMedium !== undefined ? `med+ ${area.headroomMedium}` : undefined,
    ].filter(Boolean);
    lines.push(
      `${area.pattern.padEnd(24)}  ${String(area.issueCount).padEnd(4)}  ${(budgetParts.join(", ") || "—").padEnd(12)}  ${(headroomParts.join(", ") || "—").padEnd(10)}  ${area.breached ? "BREACH" : "ok"}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function filterIssuesByPattern(issues: DebtIssue[], pattern: string): DebtIssue[] {
  return issues.filter((issue) => pathMatchesPattern(normalizePath(issue.file), pattern));
}

function normalizePath(file: string): string {
  return file.replaceAll("\\", "/");
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.includes("*")) {
    let expression = "";
    for (let index = 0; index < normalizedPattern.length; index += 1) {
      const char = normalizedPattern[index];
      const next = normalizedPattern[index + 1];
      if (char === "*" && next === "*") {
        expression += ".*";
        index += 1;
      } else if (char === "*") {
        expression += "[^/]*";
      } else {
        expression += escapeRegExp(char ?? "");
      }
    }
    return new RegExp(`^${expression}$`).test(path);
  }
  return path === normalizedPattern || path.startsWith(`${normalizedPattern}/`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
