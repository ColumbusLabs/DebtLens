import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareScanResults } from "../../src/core/scanComparison.js";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderCompareReport } from "../../src/reporters/compareReporter.js";

describe("compare reporter", () => {
  it("renders terminal, markdown, and JSON compare reports", () => {
    const comparison = compareScanResults(
      resultOf([issue({ id: "old", fingerprint: "old", ruleId: "todo-comment", file: "src/old.ts" })]),
      resultOf([issue({ id: "new", fingerprint: "new", ruleId: "prop-drilling", file: "src/new.ts", severity: "high" })]),
    );

    const terminal = renderCompareReport(comparison, "terminal");
    const markdown = renderCompareReport(comparison, "markdown");
    const json = JSON.parse(renderCompareReport(comparison, "json"));

    assert.match(terminal, /DebtLens Compare/);
    assert.match(terminal, /New: 1 \| Resolved: 1/);
    assert.match(terminal, /src\/new\.ts: 1 new/);
    assert.match(markdown, /^# DebtLens Compare/);
    assert.match(markdown, /\| `prop-drilling` \| 0 \| 1 \| \+1 \|/);
    assert.equal(json.delta.new, 1);
    assert.equal(json.topNewFiles[0].file, "src/new.ts");
  });

  it("marks exact metrics unavailable for summary-only comparisons", () => {
    const comparison = compareScanResults({
      summary: {
        totalIssues: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        byRule: { "todo-comment": 1 },
      },
    }, {
      summary: {
        totalIssues: 2,
        bySeverity: { info: 0, low: 1, medium: 0, high: 1 },
        byRule: { "todo-comment": 1, "prop-drilling": 1 },
      },
    });

    const terminal = renderCompareReport(comparison, "terminal");
    const markdown = renderCompareReport(comparison, "markdown");

    assert.match(terminal, /New: unavailable \| Resolved: unavailable/);
    assert.match(terminal, /Top new files:\n  Unavailable for summary-only comparison\./);
    assert.match(markdown, /New: \*\*unavailable\*\* .* Resolved: \*\*unavailable\*\*/);
    assert.match(markdown, /Unavailable for summary-only comparison\./);
  });

  it("includes comparison warnings in Markdown reports", () => {
    const previous = resultOf([]);
    const current = resultOf([]);
    current.options = { ...current.options, target: "packages/app" };

    const markdown = renderCompareReport(compareScanResults(previous, current), "markdown");

    assert.match(markdown, /## Warnings/);
    assert.match(markdown, /scan options differ \(target\)/);
  });
});

function resultOf(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const finding of issues) {
    bySeverity[finding.severity] += 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule,
      filesScanned: 1,
      rulesRun: 3,
      elapsedMs: 1,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

function issue(overrides: Partial<DebtIssue> = {}): DebtIssue {
  return {
    id: "issue",
    fingerprint: "issue",
    ruleId: "todo-comment",
    ruleName: "Todo comment",
    severity: "low",
    confidence: 0.8,
    message: "Comment contains a todo marker.",
    file: "src/app.ts",
    location: { startLine: 1 },
    tags: [],
    ...overrides,
  };
}
