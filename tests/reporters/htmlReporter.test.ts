import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderHtml } from "../../src/reporters/htmlReporter.js";

describe("html reporter", () => {
  it("renders a self-contained escaped report", () => {
    const html = renderHtml(makeResult([{
      id: "1",
      fingerprint: "1",
      ruleId: "todo-comment",
      ruleName: "Todo <comment>",
      severity: "low",
      confidence: 0.75,
      message: "Avoid <script>alert(1)</script>",
      file: "src/app.ts",
      location: { startLine: 2 },
      tags: [],
    }]));

    assert.match(html, /^<!doctype html>/);
    assert.match(html, /DebtLens Report/);
    assert.match(html, /Todo &lt;comment&gt;/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /Debt Heatmap/);
  });

  it("renders an empty state", () => {
    const html = renderHtml(makeResult([]));

    assert.match(html, /No maintainability debt found/);
  });

  it("renders escaped suppression audits", () => {
    const result = makeResult([]);
    result.suppressionDirectives = [{
      ruleId: "todo-comment",
      file: "src/<Widget>.ts",
      kind: "next-line",
      reason: "stale <exception>",
      directiveLine: 4,
      targetLine: 5,
      status: "unused",
      suppressedIssueCount: 0,
      recommendedAction: "Remove this suppression if the finding no longer exists.",
    }];

    const html = renderHtml(result);

    assert.match(html, /Suppression Audit/);
    assert.match(html, /1 directive \| 1 unused \| 0 not evaluated \| 0 file-wide \| 1 next-line \| 0 hidden findings/);
    assert.match(html, /src\/&lt;Widget&gt;\.ts:4/);
    assert.match(html, /stale &lt;exception&gt;/);
  });
});

function makeResult(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;
  return {
    schemaVersion: 1,
    issues,
    summary: { totalIssues: issues.length, bySeverity, byRule: {}, filesScanned: 1, rulesRun: 8, elapsedMs: 12 },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}
