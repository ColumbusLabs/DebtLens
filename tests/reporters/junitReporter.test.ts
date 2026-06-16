import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderJunit } from "../../src/reporters/junitReporter.js";

describe("junit reporter", () => {
  it("renders one failing testcase per finding and escapes XML", () => {
    const xml = renderJunit(makeResult([{
      id: "1",
      fingerprint: "1",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.75,
      message: "Avoid <TODO> & notes",
      file: "src/app.ts",
      location: { startLine: 2 },
      tags: [],
    }]));

    assert.match(xml, /^<\?xml version="1.0"/);
    assert.match(xml, /tests="1" failures="1"/);
    assert.match(xml, /line="2"/);
    assert.match(xml, /Avoid &lt;TODO&gt; &amp; notes/);
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
