import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderMarkdown } from "../../src/reporters/markdownReporter.js";

function makeResult(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;
  return {
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule: {},
      filesScanned: 1,
      rulesRun: 8,
      elapsedMs: 12,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

describe("rule guidance in markdown reports", () => {
  it("includes a review prompt for a finding with guidance", () => {
    const md = renderMarkdown(makeResult([{
      id: "dl_test",
      ruleId: "prop-drilling",
      ruleName: "Prop drilling",
      severity: "high",
      confidence: 0.73,
      message: "Parent forwards 5 props.",
      file: "src/Parent.tsx",
      location: { startLine: 13 },
      suggestion: "Consider colocating the data owner closer to consumers.",
      tags: [],
    }]));

    assert.match(md, /Review prompt: Can data ownership move closer to consumers/);
    assert.match(md, /Suggestion: Consider colocating/);
  });
});
