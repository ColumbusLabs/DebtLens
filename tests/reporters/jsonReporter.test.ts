import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult } from "../../src/core/types.js";
import { renderJson } from "../../src/reporters/jsonReporter.js";

const issue: DebtIssue = {
  id: "dl_json_contract",
  fingerprint: "dl_json_contract",
  ruleId: "prop-drilling",
  ruleName: "Prop drilling",
  severity: "high",
  confidence: 0.73,
  message: "Parent forwards 5 props across 1 child component.",
  file: "src/Parent.tsx",
  location: { startLine: 13, startColumn: 3, endLine: 20, endColumn: 5 },
  evidence: ["Child: a, b, c, d, e"],
  suggestion: "Consider colocating the data owner closer to consumers.",
  tags: ["react", "props", "component-design"],
};

const result: ScanResult = {
  schemaVersion: 1,
  issues: [issue],
  summary: {
    totalIssues: 1,
    bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
    byRule: { "prop-drilling": 1 },
    filesScanned: 1,
    rulesRun: 8,
    elapsedMs: 12,
  },
  options: {
    target: ".",
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["**/*.test.ts"],
    minSeverity: "medium",
    rules: ["prop-drilling"],
  },
};

describe("json reporter", () => {
  it("preserves the public ScanResult contract", () => {
    const parsed = JSON.parse(renderJson(result));

    assert.deepEqual(Object.keys(parsed), ["schemaVersion", "issues", "summary", "options"]);
    assert.equal(parsed.schemaVersion, 1);

    const [parsedIssue] = parsed.issues;
    assert.equal(parsedIssue.id, issue.id);
    assert.equal(parsedIssue.fingerprint, issue.fingerprint);
    assert.equal(parsedIssue.ruleId, issue.ruleId);
    assert.equal(parsedIssue.ruleName, issue.ruleName);
    assert.equal(parsedIssue.severity, "high");
    assert.equal(parsedIssue.confidence, issue.confidence);
    assert.equal(parsedIssue.message, issue.message);
    assert.equal(parsedIssue.file, issue.file);
    assert.deepEqual(parsedIssue.location, issue.location);
    assert.deepEqual(parsedIssue.evidence, issue.evidence);
    assert.equal(parsedIssue.suggestion, issue.suggestion);
    assert.deepEqual(parsedIssue.tags, issue.tags);

    assert.deepEqual(Object.keys(parsed.summary), [
      "totalIssues",
      "bySeverity",
      "byRule",
      "filesScanned",
      "rulesRun",
      "elapsedMs",
    ]);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.deepEqual(parsed.summary.bySeverity, { info: 0, low: 0, medium: 0, high: 1 });
    assert.deepEqual(parsed.summary.byRule, { "prop-drilling": 1 });
    assert.equal(parsed.summary.filesScanned, 1);
    assert.equal(parsed.summary.rulesRun, 8);
    assert.equal(parsed.summary.elapsedMs, 12);
  });

  it("includes optional summary warnings for integration consumers", () => {
    const parsed = JSON.parse(renderJson({
      ...result,
      summary: {
        ...result.summary,
        warnings: ["duplicate-logic inspected 2 of 4 eligible snippets because duplicate-logic.maxSnippets is capped."],
      },
    }));

    assert.deepEqual(parsed.summary.warnings, [
      "duplicate-logic inspected 2 of 4 eligible snippets because duplicate-logic.maxSnippets is capped.",
    ]);
  });

  it("includes optional baseline deltas and suppression audits for integrations", () => {
    const parsed = JSON.parse(renderJson({
      ...result,
      suppressions: [{
        ruleId: "prop-drilling",
        file: "src/Parent.tsx",
        kind: "next-line",
        reason: "tracked in PROJ-1",
        directiveLine: 12,
        targetLine: 13,
        issue,
      }],
      summary: {
        ...result.summary,
        deltaFromBaseline: {
          new: 1,
          resolved: 0,
          changed: 0,
          severityRegressions: 0,
          totalDelta: 1,
          baseline: {
            totalIssues: 0,
            bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
            byRule: {},
          },
          current: {
            totalIssues: 1,
            bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
            byRule: { "prop-drilling": 1 },
          },
          hasBaselineSummary: true,
          byRule: { "prop-drilling": { baseline: 0, current: 1, delta: 1 } },
        },
      },
    }));

    assert.equal(parsed.suppressions[0].reason, "tracked in PROJ-1");
    assert.equal(parsed.suppressions[0].issue.fingerprint, "dl_json_contract");
    assert.equal(parsed.summary.deltaFromBaseline.totalDelta, 1);
    assert.equal(parsed.summary.deltaFromBaseline.byRule["prop-drilling"].delta, 1);
  });

  it("includes optional duplicate-logic clusters for integrations", () => {
    const parsed = JSON.parse(renderJson({
      ...result,
      summary: {
        ...result.summary,
        duplicateClusters: [{
          clusterId: "dup_test",
          issueCount: 2,
          locations: [
            { file: "src/a.ts", startLine: 10, endLine: 20 },
            { file: "src/b.ts", startLine: 30, endLine: 40 },
          ],
        }],
      },
    }));

    assert.equal(parsed.summary.duplicateClusters[0].clusterId, "dup_test");
    assert.equal(parsed.summary.duplicateClusters[0].locations[1].file, "src/b.ts");
  });
});
