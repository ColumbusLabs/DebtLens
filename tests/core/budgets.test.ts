import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBudgets, renderBudgetReport } from "../../src/core/budgets.js";
import type { ScanResult } from "../../src/core/types.js";

function makeResult(issues: ScanResult["issues"]): ScanResult {
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity: {
        high: issues.filter((issue) => issue.severity === "high").length,
        medium: issues.filter((issue) => issue.severity === "medium").length,
        low: issues.filter((issue) => issue.severity === "low").length,
        info: issues.filter((issue) => issue.severity === "info").length,
      },
      byRule: {},
      filesScanned: 1,
      rulesRun: 1,
      elapsedMs: 1,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "low" },
  };
}

describe("budget evaluation", () => {
  it("detects per-area breaches", () => {
    const result = makeResult([
      { id: "1", fingerprint: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "high", confidence: 1, file: "src/payments/a.ts", message: "todo", tags: [] },
      { id: "2", fingerprint: "2", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, file: "src/other/b.ts", message: "todo", tags: [] },
    ]);
    const evaluation = evaluateBudgets(result, {
      "src/payments": { maxIssues: 0, maxHigh: 0 },
    });
    assert.ok(evaluation?.breached);
    assert.match(evaluation?.messages.join("\n") ?? "", /src\/payments/);
  });

  it("matches nested paths under a glob prefix", () => {
    const result = makeResult([
      { id: "1", fingerprint: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, file: "src/payments/nested/a.ts", message: "todo", tags: [] },
    ]);
    const evaluation = evaluateBudgets(result, {
      "src/payments/**": { maxIssues: 0 },
    });
    assert.ok(evaluation?.breached);
  });

  it("matches globstars with or without an intermediate directory", () => {
    const result = makeResult([
      { id: "1", fingerprint: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, file: "src/a.ts", message: "todo", tags: [] },
      { id: "2", fingerprint: "2", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, file: "src/nested/b.ts", message: "todo", tags: [] },
    ]);
    const evaluation = evaluateBudgets(result, {
      "src/**/*.ts": { maxIssues: 1 },
    });
    assert.ok(evaluation?.breached);
    assert.equal(evaluation?.areas[0]?.issueCount, 2);
  });

  it("uses workspace-compatible brace and character-class globs", () => {
    const result = makeResult([
      { id: "1", fingerprint: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "high", confidence: 1, file: "packages/api/src/a.ts", message: "todo", tags: [] },
      { id: "2", fingerprint: "2", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, file: "packages/docs/src/a.ts", message: "todo", tags: [] },
    ]);
    const evaluation = evaluateBudgets(result, { "packages/{api,web}/src/[a-z].ts": { maxHigh: 0 } });
    assert.equal(evaluation?.areas[0]?.issueCount, 1);
    assert.equal(evaluation?.breached, true);
  });

  it("renders a budget report table", () => {
    const result = makeResult([]);
    const evaluation = evaluateBudgets(result, {
      "src/payments": { maxIssues: 10 },
    });
    const report = renderBudgetReport(evaluation!);
    assert.match(report, /Area budget report/);
    assert.match(report, /src\/payments/);
  });
});
