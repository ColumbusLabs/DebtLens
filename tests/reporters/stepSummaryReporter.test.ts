import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderStepSummary } from "../../src/reporters/stepSummaryReporter.js";

function makeResult(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byRule[issue.ruleId] = (byRule[issue.ruleId] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule,
      filesScanned: 12,
      rulesRun: 8,
      elapsedMs: 38,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

describe("step summary reporter", () => {
  it("renders scan stats and severity table", () => {
    const output = renderStepSummary(makeResult([]));
    assert.match(output, /## DebtLens/);
    assert.match(output, /Scanned \*\*12\*\* files/);
    assert.match(output, /\*\*38ms\*\*/);
    assert.match(output, /No maintainability debt found/);
  });

  it("renders suppression audit counts and unused actions", () => {
    const result = makeResult([]);
    result.suppressionDirectives = [{
      ruleId: "todo-comment",
      file: "src/Widget.ts",
      kind: "next-line",
      reason: "stale exception",
      directiveLine: 4,
      targetLine: 5,
      status: "unused",
      suppressedIssueCount: 0,
      recommendedAction: "Remove this suppression if the finding no longer exists.",
    }, {
      ruleId: "todo-comment",
      file: "src/Legacy.ts",
      kind: "file",
      reason: "legacy rollout debt",
      directiveLine: 1,
      status: "used",
      suppressedIssueCount: 2,
      recommendedAction: "Review whether this file-wide suppression can be narrowed to specific next-line suppressions.",
    }];

    const output = renderStepSummary(result);

    assert.match(output, /### Suppression Audit/);
    assert.match(output, /2 directives \| 1 unused \| 0 not evaluated \| 1 file-wide \| 1 next-line \| 2 hidden findings/);
    assert.match(output, /`src\/Widget\.ts:4` \*\*todo-comment\*\* \(next-line, unused\) - Reason: stale exception\. Action: Remove this suppression/);
    assert.match(output, /`src\/Legacy\.ts:1` \*\*todo-comment\*\* \(file-wide, used\) - Reason: legacy rollout debt\. Action: Review whether this file-wide suppression can be narrowed/);
    assert.match(output, /No maintainability debt found/);
  });

  it("lists up to five findings sorted by severity then confidence", () => {
    const issues: DebtIssue[] = [
      {
        id: "1",
        ruleId: "naming-drift",
        ruleName: "Naming drift",
        severity: "info",
        confidence: 0.9,
        message: "Info finding",
        file: "a.ts",
        location: { startLine: 1 },
        tags: [],
      },
      {
        id: "2",
        ruleId: "prop-drilling",
        ruleName: "Prop drilling",
        severity: "high",
        confidence: 0.7,
        message: "High finding",
        file: "b.tsx",
        location: { startLine: 2 },
        tags: [],
      },
      {
        id: "3",
        ruleId: "state-sprawl",
        ruleName: "State sprawl",
        severity: "medium",
        confidence: 0.95,
        message: "Medium finding",
        file: "c.tsx",
        location: { startLine: 3 },
        tags: [],
      },
    ];
    const output = renderStepSummary(makeResult(issues));
    assert.match(output, /### Top findings/);
    assert.match(output, /`b\.tsx:2` \*\*prop-drilling\*\*/);
    assert.match(output, /`c\.tsx:3` \*\*state-sprawl\*\*/);
    assert.match(output, /`a\.ts:1` \*\*naming-drift\*\*/);
    const highIndex = output.indexOf("prop-drilling");
    const mediumIndex = output.indexOf("state-sprawl");
    const infoIndex = output.indexOf("naming-drift");
    assert.ok(highIndex < mediumIndex && mediumIndex < infoIndex);
  });

  it("notes when more than five findings exist", () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({
      id: String(index),
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low" as const,
      confidence: 0.5,
      message: `Finding ${index}`,
      file: `file${index}.ts`,
      location: { startLine: index + 1 },
      tags: [],
    }));
    const output = renderStepSummary(makeResult(issues));
    assert.match(output, /…and 2 more finding\(s\)/);
  });

  it("renders a trend when a valid previous result is provided", () => {
    const previous = makeResult([{
      id: "shared",
      fingerprint: "shared",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.5,
      message: "Finding",
      file: "file.ts",
      tags: [],
    }]);
    const current = makeResult([{
      id: "shared",
      fingerprint: "shared",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "high",
      confidence: 0.5,
      message: "Finding",
      file: "file.ts",
      tags: [],
    }, {
      id: "new",
      fingerprint: "new",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.5,
      message: "Finding",
      file: "file.ts",
      tags: [],
    }]);

    const output = renderStepSummary(current, { previousResult: previous });

    assert.match(output, /### Trend/);
    assert.match(output, /New: \*\*1\*\* .* Resolved: \*\*0\*\* .* Changed: \*\*1\*\* .* Severity regressions: \*\*1\*\* .* Total: \*\*\+1\*\*/);
    assert.match(output, /\| Severity \| Previous \| Current \| Delta \|/);
    assert.match(output, /\| High \| 0 \| 1 \| \+1 \|/);
    assert.match(output, /\| Low \| 1 \| 1 \| 0 \|/);
  });

  it("renders a summary-only trend with unavailable exact metrics", () => {
    const previous = {
      summary: {
        totalIssues: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        byRule: { "todo-comment": 1 },
      },
    };
    const current = makeResult([{
      id: "1",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "high",
      confidence: 0.5,
      message: "Finding",
      file: "file.ts",
      tags: [],
    }]);

    const output = renderStepSummary(current, { previousResult: previous });

    assert.match(output, /New: \*\*unavailable\*\* .* Resolved: \*\*unavailable\*\*/);
    assert.match(output, /\| High \| 0 \| 1 \| \+1 \|/);
  });

  it("renders trend warnings in the step summary", () => {
    const previous = makeResult([]);
    const current = makeResult([]);
    current.options = { ...current.options, target: "packages/app" };

    const output = renderStepSummary(current, { previousResult: previous });

    assert.match(output, /Trend warnings:/);
    assert.match(output, /scan options differ \(target\)/);
  });
});
