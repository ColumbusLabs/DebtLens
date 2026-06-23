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

  it("renders suppression audits as skipped testcases", () => {
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

    const xml = renderJunit(result);

    assert.match(xml, /tests="1" failures="0" skipped="1"/);
    assert.match(xml, /<testsuite name="DebtLens suppression audit" tests="1" failures="0" skipped="1">/);
    assert.match(xml, /<skipped message="\[todo-comment\] Remove this suppression if the finding no longer exists\."/);
    assert.match(xml, /src\/&lt;Widget&gt;\.ts:4/);
    assert.match(xml, /Reason: stale &lt;exception&gt;/);
  });

  it("marks only findings at or above the configured severity as failures", () => {
    const xml = renderJunit(makeResult([{
      id: "high",
      fingerprint: "high",
      ruleId: "prop-drilling",
      ruleName: "Prop drilling",
      severity: "high",
      confidence: 0.8,
      message: "High severity issue",
      file: "src/high.tsx",
      location: { startLine: 10 },
      tags: [],
    }, {
      id: "low",
      fingerprint: "low",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.75,
      message: "Lower severity issue",
      file: "src/low.ts",
      location: { startLine: 20 },
      tags: [],
    }]), { failOn: "high" });

    assert.match(xml, /<testsuites name="DebtLens" tests="2" failures="1" skipped="1">/);
    assert.match(xml, /<testsuite name="DebtLens findings" tests="2" failures="1" skipped="1">/);
    assert.match(xml, /<failure type="high" message="\[prop-drilling\] High severity issue">/);
    assert.match(xml, /<skipped message="\[todo-comment\] Lower severity issue">/);
    assert.doesNotMatch(xml, /<failure type="low"/);
  });
});

function makeResult(issues: ScanResult["issues"]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;
  return {
    schemaVersion: 1,
    issues,
    summary: { totalIssues: issues.length, bySeverity, byRule: {}, filesScanned: 1, rulesRun: 8, elapsedMs: 12 },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}
