import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDebtHeatmap, buildDuplicateLogicClusters, buildFixTargets, buildRuleCorrelations, groupIssuesByFile, groupIssuesByRule, summarizeIssues } from "../../src/core/issueAggregates.js";
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

  it("ranks fix targets deterministically with severity, rule diversity, and duplicate clusters", () => {
    const duplicateClusters = buildDuplicateLogicClusters([
      makeDuplicateIssue("dup", [
        "src/cluster.ts:1-12 (12 lines)",
        "src/peer.ts:4-15 (12 lines)",
      ]),
    ]);
    const targets = buildFixTargets([
      makeIssue("low", "todo-comment", "Todo comment", "low", "src/many-low.ts"),
      makeIssue("low-2", "naming-drift", "Naming drift", "info", "src/many-low.ts"),
      makeIssue("high", "prop-drilling", "Prop drilling", "high", "src/high.ts"),
      makeIssue("cluster", "duplicate-logic", "Duplicate logic", "medium", "src/cluster.ts"),
    ], { duplicateClusters, limit: 2 });

    assert.deepEqual(targets.map((target) => target.file), ["src/high.ts", "src/cluster.ts"]);
    assert.ok(targets[1].reasons.some((reason) => reason.includes("duplicate cluster")));
    assert.deepEqual(targets[0].topRules, [{ ruleId: "prop-drilling", count: 1 }]);
  });

  it("builds duplicate clusters for language-specific duplicate rules", () => {
    const duplicateClusters = buildDuplicateLogicClusters([
      makeDuplicateIssue("python", [
        "pkg/a.py:10-20 (11 lines)",
        "pkg/b.py:30-40 (11 lines)",
      ], "python-duplicate-logic"),
    ]);
    const targets = buildFixTargets([
      makeIssue("py", "python-duplicate-logic", "Python duplicate logic", "medium", "pkg/a.py"),
    ], { duplicateClusters });

    assert.equal(duplicateClusters.length, 1);
    assert.deepEqual(duplicateClusters[0].locations.map((location) => location.file), ["pkg/a.py", "pkg/b.py"]);
    assert.equal(targets[0].duplicateClusters, 1);
    assert.ok(targets[0].reasons.some((reason) => reason.includes("duplicate cluster")));
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

function makeDuplicateIssue(id: string, evidence: string[], ruleId = "duplicate-logic"): DebtIssue {
  return {
    ...makeIssue(id, ruleId, "Duplicate logic", "medium", "src/a.ts"),
    evidence,
  };
}
