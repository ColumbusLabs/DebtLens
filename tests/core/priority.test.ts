import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePayoffScore, selectTopPayoffResult, sortIssuesByPayoff, topPayoffIssues } from "../../src/core/priority.js";
import type { DebtIssue, ScanResult } from "../../src/core/types.js";

const baseIssue: DebtIssue = {
  id: "1",
  ruleId: "todo-comment",
  ruleName: "Todo",
  severity: "medium",
  confidence: 0.8,
  message: "todo",
  file: "src/a.ts",
  tags: [],
};

describe("payoff ranking", () => {
  it("ranks higher severity and churn ahead of lower-noise findings", () => {
    const hot: DebtIssue = { ...baseIssue, id: "hot", severity: "high", file: "src/hot.ts" };
    const cold: DebtIssue = { ...baseIssue, id: "cold", severity: "low", file: "src/cold.ts" };
    const churnByFile = new Map<string, number>([["src/hot.ts", 20]]);
    hot.payoffScore = computePayoffScore(hot, { churnByFile });
    cold.payoffScore = computePayoffScore(cold, { churnByFile });
    const sorted = sortIssuesByPayoff([cold, hot]);
    assert.equal(sorted[0]?.id, "hot");
  });

  it("sorts deterministically by score then file", () => {
    const left: DebtIssue = { ...baseIssue, id: "left", file: "src/a.ts", payoffScore: 5 };
    const right: DebtIssue = { ...baseIssue, id: "right", file: "src/b.ts", payoffScore: 5 };
    const sorted = sortIssuesByPayoff([right, left]);
    assert.equal(sorted[0]?.id, "left");
  });

  it("uses rule and identity tie-breakers for otherwise identical targets", () => {
    const first: DebtIssue = { ...baseIssue, id: "a", ruleId: "a-rule", payoffScore: 5 };
    const second: DebtIssue = { ...baseIssue, id: "b", ruleId: "b-rule", payoffScore: 5 };
    assert.deepEqual(sortIssuesByPayoff([second, first]).map((issue) => issue.id), ["a", "b"]);
  });

  it("bounds machine-facing payoff targets to ten by default", () => {
    const issues = Array.from({ length: 12 }, (_, index) => ({
      ...baseIssue,
      id: String(index),
      payoffScore: index,
    }));
    assert.equal(topPayoffIssues(issues).length, 10);
    assert.equal(topPayoffIssues(issues)[0]?.payoffScore, 11);
  });

  it("builds a count-consistent presentation result without mutating the full scan", () => {
    const issues = [
      { ...baseIssue, id: "low", fingerprint: "low", severity: "low" as const, payoffScore: 2 },
      { ...baseIssue, id: "high", fingerprint: "high", file: "src/b.ts", severity: "high" as const, payoffScore: 12 },
    ];
    const result: ScanResult = {
      schemaVersion: 1,
      issues,
      summary: {
        totalIssues: 2,
        bySeverity: { info: 0, low: 1, medium: 0, high: 1 },
        byRule: { "todo-comment": 2 },
        filesScanned: 2,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: [], exclude: [], minSeverity: "low", rules: ["todo-comment"] },
    };

    const selected = selectTopPayoffResult(result, 1);

    assert.equal(result.issues.length, 2);
    assert.deepEqual(selected.issues.map((issue) => issue.id), ["high"]);
    assert.equal(selected.summary.totalIssues, selected.issues.length);
    assert.deepEqual(selected.summary.bySeverity, { info: 0, low: 0, medium: 0, high: 1 });
    assert.deepEqual(selected.summary.issueSelection, {
      strategy: "payoff",
      limit: 1,
      totalAvailable: 2,
      omitted: 1,
    });
  });
});
