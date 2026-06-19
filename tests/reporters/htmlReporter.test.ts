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
    assert.match(html, /Fix These First/);
    assert.match(html, /1 low-severity finding/);
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

  it("renders optional git churn hotspots", () => {
    const result = makeResult([{
      id: "1",
      fingerprint: "1",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.75,
      message: "Avoid TODO markers",
      file: "src/app.ts",
      location: { startLine: 2 },
      tags: [],
    }]);
    result.summary.hotspots = {
      source: "git",
      window: { days: 7 },
      ranking: [{
        file: "src/app.ts",
        repositoryPath: "src/app.ts",
        totalIssues: 1,
        distinctRules: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        score: 11.5,
        churn: { file: "src/app.ts", repositoryPath: "src/app.ts", commits: 2, additions: 10, deletions: 5, changedLines: 15 },
        reasons: ["1 low-severity finding", "2 recent commits"],
        topRules: [{ ruleId: "todo-comment", count: 1 }],
      }],
    };

    const html = renderHtml(result);

    assert.match(html, /Git Churn Hotspots/);
    assert.match(html, /Optional git-derived ranking from the last 7 days/);
    assert.match(html, /2 commits, 15 changed lines/);
  });

  it("renders optional CODEOWNERS ownership handoffs", () => {
    const result = makeResult([{
      id: "1",
      fingerprint: "1",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.75,
      message: "Avoid TODO markers",
      file: "src/app.ts",
      location: { startLine: 2 },
      tags: [],
    }]);
    result.summary.ownership = {
      source: "codeowners",
      codeownersPath: ".github/CODEOWNERS",
      files: [],
      ownerSummaries: [{
        owner: "@frontend/team",
        files: 1,
        totalIssues: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        topFiles: [{ file: "src/app.ts", totalIssues: 1, score: 8 }],
      }],
      handoffs: [],
      unownedHotspots: [{
        file: "src/orphan.ts",
        repositoryPath: "src/orphan.ts",
        owners: [],
        totalIssues: 1,
        distinctRules: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        score: 8,
        reasons: ["1 low-severity finding"],
        topRules: [{ ruleId: "todo-comment", count: 1 }],
      }],
    };

    const html = renderHtml(result);

    assert.match(html, /Ownership Handoffs/);
    assert.match(html, /@frontend\/team/);
    assert.match(html, /Unowned High-Debt Files/);
    assert.match(html, /src\/orphan\.ts/);
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
