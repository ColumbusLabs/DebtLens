import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBaseline,
  addIssuesToBaseline,
  compareBaseline,
  compareBaselineDetailed,
  computeFingerprint,
  createBaseline,
  filterIssues,
  pruneBaseline,
  updateBaseline,
} from "../../src/core/baseline.js";
import type { Baseline } from "../../src/core/baseline.js";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";

function issue(overrides: Partial<DebtIssue> = {}): ScanResult["issues"][number] {
  const finding: DebtIssue = {
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
  return {
    ...finding,
    fingerprint: overrides.fingerprint ?? computeFingerprint(finding),
  };
}

function resultOf(issues: ScanResult["issues"]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const i of issues) bySeverity[i.severity] += 1;
  return {
    schemaVersion: 1,
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

describe("createBaseline", () => {
  it("stores count metadata for regression comparisons", () => {
    const baseline = createBaseline([
      issue({ ruleId: "duplicate-logic", severity: "medium" }),
      issue({ ruleId: "todo-comment", severity: "low", file: "src/todo.ts", message: "Comment contains a todo marker." }),
    ]);

    assert.equal(baseline.summary?.totalIssues, 2);
    assert.equal(baseline.summary?.byRule["duplicate-logic"], 1);
    assert.equal(baseline.summary?.byRule["todo-comment"], 1);
    assert.equal(baseline.summary?.bySeverity.medium, 1);
    assert.equal(baseline.summary?.bySeverity.low, 1);
    assert.equal(Object.keys(baseline.issues ?? {}).length, 2);
  });
});

describe("compareBaseline", () => {
  it("reports new, resolved, total, and per-rule deltas", () => {
    const oldDuplicate = issue({ ruleId: "duplicate-logic", severity: "medium" });
    const oldTodo = issue({ ruleId: "todo-comment", severity: "low", file: "src/todo.ts", message: "Comment contains a todo marker." });
    const newState = issue({ ruleId: "state-sprawl", severity: "high", file: "src/state.tsx", message: "Screen manages 9 stateful hooks." });
    const baseline = createBaseline([oldDuplicate, oldTodo]);

    const comparison = compareBaseline([oldDuplicate, newState], baseline);

    assert.deepEqual(comparison.newIssues, [newState]);
    assert.equal(comparison.delta.new, 1);
    assert.equal(comparison.delta.resolved, 1);
    assert.equal(comparison.delta.severityRegressions, 0);
    assert.equal(comparison.delta.totalDelta, 0);
    assert.equal(comparison.delta.hasBaselineSummary, true);
    assert.equal(comparison.delta.byRule["todo-comment"]?.delta, -1);
    assert.equal(comparison.delta.byRule["state-sprawl"]?.delta, 1);
  });

  it("reports changed findings when a known fingerprint changes severity", () => {
    const baselineIssue = issue({ severity: "medium" });
    const currentIssue = issue({ severity: "high" });
    const comparison = compareBaseline([currentIssue], createBaseline([baselineIssue]));

    assert.equal(comparison.newIssues.length, 0);
    assert.equal(comparison.delta.changed, 1);
    assert.equal(comparison.delta.severityRegressions, 1);
  });
});

describe("baseline maintenance helpers", () => {
  it("adds triaged findings with summary and snapshot metadata kept consistent", () => {
    const finding = issue({ ruleId: "todo-comment", severity: "low" });
    const baseline = createBaseline([]);
    addIssuesToBaseline(baseline, [finding]);

    assert.equal(baseline.summary?.totalIssues, 1);
    assert.equal(baseline.summary?.byRule["todo-comment"], 1);
    assert.equal(baseline.summary?.bySeverity.low, 1);
    assert.equal(baseline.issues?.[finding.fingerprint]?.ruleId, "todo-comment");
    assert.equal(compareBaselineDetailed([finding], baseline).newIssues.length, 0);
  });
  it("reports detailed new, resolved, stale, and changed fingerprint data with occurrence counts", () => {
    const repeated = issue({ fingerprint: "dl_repeated" });
    const fresh = issue({
      fingerprint: "dl_fresh",
      ruleId: "state-sprawl",
      severity: "high",
      file: "src/state.tsx",
      message: "Screen manages 9 stateful hooks.",
    });
    const changedBefore = issue({ fingerprint: "dl_changed", severity: "medium" });
    const changedAfter = issue({ fingerprint: "dl_changed", severity: "high" });
    const baseline = createBaseline([repeated, repeated, repeated, changedBefore]);

    const comparison = compareBaselineDetailed([repeated, fresh, fresh, changedAfter], baseline);

    assert.deepEqual(comparison.currentFingerprints, {
      dl_changed: 1,
      dl_fresh: 2,
      dl_repeated: 1,
    });
    assert.deepEqual(comparison.newFingerprints, { dl_fresh: 2 });
    assert.deepEqual(comparison.resolvedFingerprints, { dl_repeated: 2 });
    assert.deepEqual(comparison.staleFingerprints, { dl_repeated: 2 });
    assert.equal(comparison.delta.new, 2);
    assert.equal(comparison.delta.resolved, 2);
    assert.equal(comparison.delta.changed, 1);
    assert.equal(comparison.delta.severityRegressions, 1);
    assert.equal(comparison.changedIssues.length, 1);
    assert.equal(comparison.changedIssues[0]?.fingerprint, "dl_changed");
    assert.equal(comparison.changedIssues[0]?.severityRegressed, true);
    assert.equal(comparison.changedFingerprints.dl_changed?.occurrenceCount, 1);
  });

  it("prunes resolved occurrences while preserving unknown top-level metadata", () => {
    const kept = issue({ fingerprint: "dl_kept" });
    const stale = issue({
      fingerprint: "dl_stale",
      ruleId: "todo-comment",
      severity: "low",
      file: "src/todo.ts",
      message: "Comment contains a todo marker.",
    });
    const baseline: Baseline = {
      ...createBaseline([kept, kept, stale]),
      owner: "platform",
      labels: ["reviewed"],
    };
    const comparison = compareBaselineDetailed([kept], baseline);

    const pruned = pruneBaseline(baseline, comparison);

    assert.deepEqual(pruned.fingerprints, { dl_kept: 1 });
    assert.equal(pruned.issues?.dl_kept?.count, 1);
    assert.equal(pruned.issues?.dl_stale, undefined);
    assert.equal(pruned.summary?.totalIssues, 1);
    assert.equal(pruned.summary?.byRule["duplicate-logic"], 1);
    assert.equal(pruned.owner, "platform");
    assert.deepEqual(pruned.labels, ["reviewed"]);
  });

  it("prunes legacy baselines without adding summary or issue metadata", () => {
    const repeated = issue({ fingerprint: "dl_legacy" });
    const legacy: Baseline = {
      version: 1,
      generatedAt: "2026-06-16T00:00:00.000Z",
      fingerprints: { dl_legacy: 2 },
    };
    const comparison = compareBaselineDetailed([repeated], legacy);

    const pruned = pruneBaseline(legacy, comparison);

    assert.deepEqual(comparison.resolvedFingerprints, { dl_legacy: 1 });
    assert.deepEqual(pruned.fingerprints, { dl_legacy: 1 });
    assert.equal("summary" in pruned, false);
    assert.equal("issues" in pruned, false);
  });

  it("updates a baseline from current issues while preserving previous top-level metadata", () => {
    const kept = issue({ fingerprint: "dl_kept" });
    const stale = issue({ fingerprint: "dl_stale", file: "src/stale.ts" });
    const fresh = issue({
      fingerprint: "dl_fresh",
      ruleId: "state-sprawl",
      severity: "high",
      file: "src/state.tsx",
      message: "Screen manages 9 stateful hooks.",
    });
    const previous: Baseline = {
      ...createBaseline([kept, stale]),
      owner: "platform",
    };

    const updated = updateBaseline([kept, fresh], previous, {
      generatedAt: "2026-06-19T12:00:00.000Z",
    });

    assert.deepEqual(updated.fingerprints, { dl_fresh: 1, dl_kept: 1 });
    assert.equal(updated.generatedAt, "2026-06-19T12:00:00.000Z");
    assert.equal(updated.owner, "platform");
    assert.equal(updated.summary?.totalIssues, 2);
    assert.equal(updated.summary?.bySeverity.high, 1);
    assert.equal(updated.issues?.dl_fresh?.ruleId, "state-sprawl");
    assert.equal(updated.issues?.dl_stale, undefined);
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
    assert.equal(out.summary.deltaFromBaseline?.new, 1);
    assert.equal(out.summary.deltaFromBaseline?.resolved, 0);
  });

  it("records suppressed baseline counts in filter stats", () => {
    const baselined = issue();
    const fresh = issue({ ruleId: "state-sprawl", file: "src/z.ts" });
    const out = applyBaseline(resultOf([baselined, fresh]), createBaseline([baselined]));
    assert.equal(out.summary.filterStats?.suppressedByBaseline, 1);
  });

  it("clears duplicate clusters after baseline filtering suppresses duplicate findings", () => {
    const baselined = issue();
    const fresh = issue({ ruleId: "todo-comment", file: "src/z.ts", message: "Comment contains a todo marker." });
    const result = resultOf([baselined, fresh]);
    result.summary.duplicateClusters = [{
      clusterId: "dup_stale",
      issueCount: 1,
      locations: [
        { file: "src/a.ts", startLine: 10, endLine: 20 },
        { file: "src/b.ts", startLine: 5, endLine: 15 },
      ],
    }];

    const out = applyBaseline(result, createBaseline([baselined]));

    assert.equal(out.issues.length, 1);
    assert.equal(out.summary.totalIssues, 1);
    assert.equal(out.summary.duplicateClusters, undefined);
  });

  it("keeps total deltas for legacy baselines without claiming per-rule metadata", () => {
    const baselined = issue();
    const legacyBaseline = {
      version: 1,
      generatedAt: "2026-06-16T00:00:00.000Z",
      fingerprints: createBaseline([baselined]).fingerprints,
    };

    const out = applyBaseline(resultOf([baselined]), legacyBaseline);

    assert.equal(out.summary.totalIssues, 0);
    assert.equal(out.summary.deltaFromBaseline?.totalDelta, 0);
    assert.equal(out.summary.deltaFromBaseline?.hasBaselineSummary, false);
    assert.deepEqual(out.summary.deltaFromBaseline?.baseline.byRule, {});
  });
});
