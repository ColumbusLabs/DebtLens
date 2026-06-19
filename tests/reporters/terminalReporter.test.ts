import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderReport } from "../../src/reporters/index.js";
import { renderTerminal } from "../../src/reporters/terminalReporter.js";

function makeResult(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule: {},
      filesScanned: 3,
      rulesRun: 8,
      elapsedMs: 42,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

const issue: DebtIssue = {
  id: "dl_test",
  ruleId: "prop-drilling",
  ruleName: "Prop drilling",
  severity: "high",
  confidence: 0.9,
  message: "Parent forwards 5 props across 2 components.",
  file: "src/Parent.tsx",
  location: { startLine: 10, endLine: 20 },
  tags: [],
};

describe("renderTerminal", () => {
  it("includes summary line", () => {
    const out = renderTerminal(makeResult([issue]), { color: false });
    assert.ok(out.includes("Issues: 1 | high 1"));
  });

  it("includes individual findings by default", () => {
    const out = renderTerminal(makeResult([issue]), { color: false });
    assert.ok(out.includes("Prop drilling"));
    assert.ok(out.includes("src/Parent.tsx"));
  });

  it("quiet mode omits individual findings", () => {
    const out = renderTerminal(makeResult([issue]), { color: false, quiet: true });
    assert.ok(out.includes("Issues: 1 | high 1"), "summary should be present");
    assert.ok(!out.includes("src/Parent.tsx"), "file path should not appear in quiet mode");
    assert.ok(!out.includes("Prop drilling"), "rule name should not appear in quiet mode");
  });

  it("quiet mode still shows summary when no issues", () => {
    const out = renderTerminal(makeResult([]), { color: false, quiet: true });
    assert.ok(out.includes("Issues: 0"));
    assert.ok(!out.includes("No maintainability debt found"));
  });

  it("includes filter stats when present", () => {
    const out = renderTerminal({
      ...makeResult([]),
      summary: {
        ...makeResult([]).summary,
        filterStats: { suppressedByBaseline: 2, filteredByMinSeverity: 3 },
      },
    }, { color: false });
    assert.match(out, /Filtered: 2 baselined \| 3 below min severity/);
  });

  it("renders suppression audit summaries and details", () => {
    const out = renderTerminal({
      ...makeResult([]),
      suppressionDirectives: [{
        ruleId: "todo-comment",
        file: "src/Widget.ts",
        kind: "next-line",
        reason: "stale exception",
        directiveLine: 4,
        targetLine: 5,
        status: "unused",
        suppressedIssueCount: 0,
        recommendedAction: "Remove this suppression if the finding no longer exists.",
      }],
    }, { color: false });

    assert.match(out, /Suppression audit: 1 directive \| 1 unused \| 0 not evaluated \| 0 file-wide \| 1 next-line \| 0 hidden findings/);
    assert.match(out, /unused next-line src\/Widget\.ts:4 \[todo-comment\] -> target line 5/);
    assert.match(out, /action: Remove this suppression/);
  });

  it("can group findings by rule or file", () => {
    const second = { ...issue, id: "dl_2", ruleId: "state-sprawl", ruleName: "State sprawl", file: "src/State.tsx" };

    const byRule = renderTerminal(makeResult([issue, second]), { color: false, groupBy: "rule" });
    const byFile = renderTerminal(makeResult([issue, second]), { color: false, groupBy: "file" });

    assert.match(byRule, /Grouped by rule \(2\)/);
    assert.match(byRule, /prop-drilling \(1\)/);
    assert.match(byFile, /Grouped by file \(2\)/);
    assert.match(byFile, /src\/Parent\.tsx \(1\)/);
  });

  it("rejects unknown formats instead of falling through to terminal output", () => {
    assert.throws(
      () => renderReport(makeResult([issue]), "nope" as never),
      /Invalid format "nope"/,
    );
  });

  it("does not colorize when color is explicitly false", () => {
    const out = renderReport(makeResult([issue]), "terminal", { color: false });

    assert.doesNotMatch(out, /\u001b\[/);
  });
});
