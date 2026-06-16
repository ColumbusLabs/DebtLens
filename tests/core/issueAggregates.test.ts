import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDebtHeatmap, buildDuplicateLogicClusters, buildRuleCorrelations, groupIssuesByFile, groupIssuesByRule, summarizeIssues } from "../../src/core/issueAggregates.js";
import type { DebtIssue } from "../../src/core/types.js";

const issues: DebtIssue[] = [
  makeIssue("a", "state-sprawl", "State sprawl", "medium", "src/App.tsx"),
  makeIssue("b", "prop-drilling", "Prop drilling", "high", "src/App.tsx"),
  makeIssue("c", "todo-comment", "Todo comment", "low", "src/other.ts"),
];

describe("issue aggregates", () => {
  it("summarizes counts by severity and rule", () => {
    const summary = summarizeIssues(issues);

    assert.equal(summary.totalIssues, 3);
    assert.equal(summary.bySeverity.high, 1);
    assert.equal(summary.byRule["prop-drilling"], 1);
  });

  it("groups issues by file and rule in stable count order", () => {
    assert.deepEqual(groupIssuesByFile(issues).map(([name]) => name), ["src/App.tsx", "src/other.ts"]);
    assert.deepEqual(groupIssuesByRule(issues).map(([name]) => name), ["prop-drilling", "state-sprawl", "todo-comment"]);
  });

  it("builds correlations only for files with multiple distinct rules", () => {
    const correlations = buildRuleCorrelations(issues);

    assert.equal(correlations.length, 1);
    assert.equal(correlations[0].file, "src/App.tsx");
    assert.equal(correlations[0].rules.length, 2);
  });

  it("builds heatmap rows with distinct rule counts", () => {
    const heatmap = buildDebtHeatmap(issues, 1);

    assert.equal(heatmap.length, 1);
    assert.equal(heatmap[0].file, "src/App.tsx");
    assert.equal(heatmap[0].distinctRules, 2);
  });

  it("builds transitive duplicate-logic clusters from pair findings", () => {
    const clusters = buildDuplicateLogicClusters([
      makeDuplicateIssue("ab", [
        "src/a.ts:10-20 (11 lines)",
        "src/b.ts:30-40 (11 lines)",
      ]),
      makeDuplicateIssue("bc", [
        "src/b.ts:30-40 (11 lines)",
        "src/c.ts:50-60 (11 lines)",
      ]),
      makeIssue("todo", "todo-comment", "Todo comment", "low", "src/a.ts"),
    ]);

    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].issueCount, 2);
    assert.deepEqual(clusters[0].locations.map((location) => `${location.file}:${location.startLine}`), [
      "src/a.ts:10",
      "src/b.ts:30",
      "src/c.ts:50",
    ]);
  });
});

function makeIssue(id: string, ruleId: string, ruleName: string, severity: DebtIssue["severity"], file: string): DebtIssue {
  return {
    id,
    fingerprint: id,
    ruleId,
    ruleName,
    severity,
    confidence: 0.8,
    message: `${ruleName} message`,
    file,
    tags: [],
  };
}

function makeDuplicateIssue(id: string, evidence: string[]): DebtIssue {
  return {
    ...makeIssue(id, "duplicate-logic", "Duplicate logic", "medium", "src/a.ts"),
    evidence,
  };
}
