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
});
