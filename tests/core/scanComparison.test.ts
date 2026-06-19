import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareScanResults, normalizeComparableScanSnapshot } from "../../src/core/scanComparison.js";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";

describe("scan result comparison", () => {
  it("compares totals, severity deltas, rule deltas, new files, and resolved findings", () => {
    const previous = resultOf([
      issue({ id: "old", fingerprint: "old", ruleId: "todo-comment", file: "src/old.ts", severity: "low" }),
      issue({ id: "shared", fingerprint: "shared", ruleId: "state-sprawl", file: "src/App.tsx", severity: "medium" }),
    ]);
    const current = resultOf([
      issue({ id: "shared", fingerprint: "shared", ruleId: "state-sprawl", file: "src/App.tsx", severity: "high" }),
      issue({ id: "new-a", fingerprint: "new-a", ruleId: "todo-comment", file: "src/new.ts", severity: "low" }),
      issue({ id: "new-b", fingerprint: "new-b", ruleId: "prop-drilling", file: "src/new.ts", severity: "high" }),
    ]);

    const comparison = compareScanResults(previous, current);

    assert.equal(comparison.previous.totalIssues, 2);
    assert.equal(comparison.current.totalIssues, 3);
    assert.equal(comparison.delta.total, 1);
    assert.equal(comparison.delta.new, 2);
    assert.equal(comparison.delta.resolved, 1);
    assert.equal(comparison.delta.changed, 1);
    assert.equal(comparison.delta.severityRegressions, 1);
    assert.deepEqual(comparison.delta.bySeverity.find((entry) => entry.severity === "high"), {
      severity: "high",
      previous: 0,
      current: 2,
      delta: 2,
    });
    assert.deepEqual(comparison.delta.byRule.find((entry) => entry.ruleId === "prop-drilling"), {
      ruleId: "prop-drilling",
      previous: 0,
      current: 1,
      delta: 1,
    });
    assert.deepEqual(comparison.topNewFiles[0], {
      file: "src/new.ts",
      count: 2,
      bySeverity: { info: 0, low: 1, medium: 0, high: 1 },
      byRule: { "todo-comment": 1, "prop-drilling": 1 },
    });
  });

  it("does not require summary or fingerprint fields from older reports", () => {
    const previous = {
      issues: [issue({ id: "legacy", fingerprint: undefined, file: "src/legacy.ts", message: "Legacy todo" })],
    } as ScanResult;
    const current = {
      issues: [issue({ id: "legacy-current", fingerprint: undefined, file: "src/legacy.ts", message: "Legacy todo" })],
    } as ScanResult;

    const comparison = compareScanResults(previous, current);

    assert.equal(comparison.delta.total, 0);
    assert.equal(comparison.delta.new, 0);
    assert.equal(comparison.delta.resolved, 0);
  });

  it("uses summary-only reports for aggregate deltas while marking exact metrics unavailable", () => {
    const previous = {
      summary: {
        totalIssues: 3,
        bySeverity: { info: 0, low: 1, medium: 1, high: 1 },
        byRule: { "todo-comment": 2, "state-sprawl": 1 },
      },
    };
    const current = {
      summary: {
        totalIssues: 4,
        bySeverity: { info: 0, low: 1, medium: 0, high: 3 },
        byRule: { "todo-comment": 1, "prop-drilling": 3 },
      },
    };

    const comparison = compareScanResults(previous, current);

    assert.equal(comparison.delta.total, 1);
    assert.equal(comparison.delta.new, null);
    assert.equal(comparison.delta.resolved, null);
    assert.equal(comparison.accuracy.issueIdentity, "unavailable");
    assert.deepEqual(comparison.delta.bySeverity.find((entry) => entry.severity === "high"), {
      severity: "high",
      previous: 1,
      current: 3,
      delta: 2,
    });
    assert.deepEqual(comparison.delta.byRule.find((entry) => entry.ruleId === "prop-drilling"), {
      ruleId: "prop-drilling",
      previous: 0,
      current: 3,
      delta: 3,
    });
    assert.deepEqual(comparison.topNewFiles, []);
  });

  it("recomputes incomplete or stale summaries from issue arrays", () => {
    const snapshot = normalizeComparableScanSnapshot({
      schemaVersion: 1,
      issues: [
        issue({ id: "one", ruleId: "todo-comment", severity: "low" }),
        issue({ id: "two", ruleId: "prop-drilling", severity: "high" }),
      ],
      summary: {
        totalIssues: 99,
        bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
        byRule: {},
      },
    });

    assert.equal(snapshot.summary.totalIssues, 2);
    assert.equal(snapshot.summary.bySeverity.high, 1);
    assert.equal(snapshot.summary.byRule["prop-drilling"], 1);
    assert.match(snapshot.warnings.join("\n"), /summary does not match/);
  });

  it("preserves occurrence-aware new and resolved counts for duplicate fingerprints", () => {
    const previous = resultOf([
      issue({ id: "dup-a", fingerprint: "dup", file: "src/a.ts" }),
      issue({ id: "dup-b", fingerprint: "dup", file: "src/a.ts" }),
    ]);
    const current = resultOf([
      issue({ id: "dup-a", fingerprint: "dup", file: "src/a.ts" }),
      issue({ id: "dup-new", fingerprint: "dup", file: "src/a.ts" }),
      issue({ id: "dup-extra", fingerprint: "dup", file: "src/a.ts" }),
    ]);

    const comparison = compareScanResults(previous, current);

    assert.equal(comparison.delta.new, 1);
    assert.equal(comparison.delta.resolved, 0);
  });

  it("warns when scan scopes differ", () => {
    const previous = resultOf([]);
    const current = resultOf([]);
    current.options = { ...current.options, target: "packages/app" };

    const comparison = compareScanResults(previous, current);

    assert.match(comparison.warnings.join("\n"), /scan options differ \(target\)/);
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
