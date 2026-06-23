import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePayoffScore, sortIssuesByPayoff } from "../../src/core/priority.js";
import type { DebtIssue } from "../../src/core/types.js";

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
});
