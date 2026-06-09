import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBaseline,
  computeFingerprint,
  createBaseline,
  filterIssues,
} from "../../src/core/baseline.js";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";

function issue(overrides: Partial<DebtIssue> = {}): DebtIssue {
  return {
    id: "dl_x",
    ruleId: "duplicate-logic",
    ruleName: "Duplicate logic",
    severity: "medium",
    confidence: 0.9,
    message: "normalizeA is 100% structurally similar to normalizeB.",
    file: "src/a.ts",
    location: { startLine: 10, endLine: 20 },
    evidence: ["src/a.ts:10-20 (10 lines)", "src/b.ts:5-15 (10 lines)"],
    suggestion: "Compare the two implementations.",
    tags: ["duplication"],
    ...overrides,
  };
}

function resultOf(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const i of issues) bySeverity[i.severity] += 1;
  return {
    issues,
    summary: { totalIssues: issues.length, bySeverity, byRule: {}, filesScanned: 2, rulesRun: 8, elapsedMs: 5 },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

describe("baseline fingerprint", () => {
  it("is stable when only the line number shifts", () => {
    const a = issue({ location: { startLine: 10, endLine: 20 } });
    const b = issue({
      location: { startLine: 42, endLine: 52 },
      // evidence line numbers also move with the code
      evidence: ["src/a.ts:42-52 (10 lines)", "src/b.ts:30-40 (10 lines)"],
    });
    assert.equal(computeFingerprint(a), computeFingerprint(b));
  });

  it("differs for a different rule or file", () => {
    assert.notEqual(computeFingerprint(issue()), computeFingerprint(issue({ ruleId: "state-sprawl" })));
    assert.notEqual(computeFingerprint(issue()), computeFingerprint(issue({ file: "src/c.ts" })));
  });
});

describe("filterIssues", () => {
  it("suppresses issues present in the baseline", () => {
    const existing = issue();
    const baseline = createBaseline([existing]);
    assert.equal(filterIssues([existing], baseline).length, 0);
  });

  it("surfaces a newly introduced, unrelated issue", () => {
    const baseline = createBaseline([issue()]);
    const fresh = issue({ ruleId: "prop-drilling", file: "src/new.tsx", message: "Parent forwards 6 props." });
    const kept = filterIssues([issue(), fresh], baseline);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.ruleId, "prop-drilling");
  });

  it("respects occurrence counts (an extra instance surfaces)", () => {
    // Baseline captured one occurrence; now there are two identical-shaped ones.
    const baseline = createBaseline([issue()]);
    const kept = filterIssues([issue(), issue({ file: "src/a.ts" })], baseline);
    assert.equal(kept.length, 1);
  });
});

describe("applyBaseline", () => {
  it("recomputes the summary after filtering", () => {
    const baselined = issue();
    const fresh = issue({ ruleId: "state-sprawl", severity: "high", file: "src/z.ts", message: "x manages 8 hooks." });
    const baseline = createBaseline([baselined]);
    const out = applyBaseline(resultOf([baselined, fresh]), baseline);
    assert.equal(out.issues.length, 1);
    assert.equal(out.summary.totalIssues, 1);
    assert.equal(out.summary.bySeverity.high, 1);
    assert.equal(out.summary.bySeverity.medium, 0);
    // preserved fields
    assert.equal(out.summary.filesScanned, 2);
    assert.equal(out.summary.rulesRun, 8);
  });

  it("records suppressed baseline counts in filter stats", () => {
    const baselined = issue();
    const fresh = issue({ ruleId: "state-sprawl", file: "src/z.ts" });
    const out = applyBaseline(resultOf([baselined, fresh]), createBaseline([baselined]));
    assert.equal(out.summary.filterStats?.suppressedByBaseline, 1);
  });
});
