import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderPrComment } from "../../src/reporters/prCommentReporter.js";

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
      elapsedMs: 12,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

const propIssue: DebtIssue = {
  id: "dl_pr_1",
  ruleId: "prop-drilling",
  ruleName: "Prop drilling",
  severity: "high",
  confidence: 0.73,
  message: "Parent forwards 5 props across 1 child component.",
  file: "src/Parent.tsx",
  location: { startLine: 13 },
  evidence: ["Child: a, b, c, d, e"],
  suggestion: "Consider colocating the data owner closer to consumers.",
  tags: ["react"],
};

const stateIssue: DebtIssue = {
  id: "dl_pr_2",
  ruleId: "state-sprawl",
  ruleName: "State sprawl",
  severity: "medium",
  confidence: 0.82,
  message: "Parent manages 7 stateful hook calls.",
  file: "src/Parent.tsx",
  location: { startLine: 24 },
  tags: ["react"],
};

const namingIssue: DebtIssue = {
  id: "dl_pr_3",
  ruleId: "naming-drift",
  ruleName: "Naming drift",
  severity: "info",
  confidence: 0.62,
  message: "This file uses competing terms for release timing.",
  file: "src/release plan.ts",
  location: { startLine: 1 },
  evidence: ["Variants found: date, air, launch, release"],
  tags: ["naming"],
};

describe("pr-comment reporter", () => {
  it("renders grouped Markdown annotations by file", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue, namingIssue]));

    assert.match(markdown, /^<!-- debtlens-report -->\n## DebtLens findings/);
    assert.match(markdown, /\| Files scanned \| Rules run \| Total issues \| High \| Medium \| Low \| Info \|/);
    assert.match(markdown, /\| 3 \| 8 \| 3 \| 1 \| 1 \| 0 \| 1 \|/);
    assert.match(markdown, /<details><summary><code>src\/Parent\.tsx<\/code> - 2 findings<\/summary>/);
    assert.match(markdown, /- \*\*High\*\* Prop drilling \(`prop-drilling`\) at `src\/Parent\.tsx:13`: Parent forwards/);
    assert.match(markdown, /  - Confidence: \*\*73%\*\*/);
    assert.match(markdown, /  - Evidence: Child: a, b, c, d, e/);
    assert.match(markdown, /  - Suggestion: Consider colocating/);
    assert.match(markdown, /- \*\*Medium\*\* State sprawl \(`state-sprawl`\) at `src\/Parent\.tsx:24`: Parent manages/);
    assert.match(markdown, /<details><summary><code>src\/release plan\.ts<\/code> - 1 finding<\/summary>/);
  });

  it("renders baseline delta copy in delta-only mode", () => {
    const result = makeResult([propIssue]);
    result.summary.deltaFromBaseline = {
      new: 1,
      resolved: 2,
      changed: 1,
      severityRegressions: 0,
      totalDelta: -1,
      baseline: { totalIssues: 2, bySeverity: { info: 0, low: 0, medium: 0, high: 2 }, byRule: { "prop-drilling": 2 } },
      current: { totalIssues: 1, bySeverity: { info: 0, low: 0, medium: 0, high: 1 }, byRule: { "prop-drilling": 1 } },
      hasBaselineSummary: true,
      byRule: { "prop-drilling": { baseline: 2, current: 1, delta: -1 } },
    };

    const markdown = renderPrComment(result, { deltaOnly: true });

    assert.match(markdown, /Delta: -1 total, 1 new, 2 resolved, 1 changed/);
    assert.match(markdown, /Showing findings not covered by the compared baseline\. Changed findings are counted above\./);
    assert.doesNotMatch(markdown, /remain available in the JSON report/);
  });

  it("normalizes multi-line finding text for PR comments", () => {
    const markdown = renderPrComment(makeResult([{
      ...propIssue,
      message: "Parent forwards\nmany props.",
      evidence: ["first line\nsecond line"],
      suggestion: "Split\nthis.",
    }]));

    assert.match(markdown, /Parent forwards many props\./);
    assert.match(markdown, /Evidence: first line second line/);
    assert.match(markdown, /Suggestion: Split this\./);
  });

  it("renders source links when a source URL base is provided", () => {
    const markdown = renderPrComment(makeResult([namingIssue]), {
      sourceUrlBase: "https://github.com/ColumbusLabs/DebtLens/blob/abc123",
    });

    assert.match(
      markdown,
      /\[`src\/release plan\.ts:1`\]\(https:\/\/github\.com\/ColumbusLabs\/DebtLens\/blob\/abc123\/src\/release%20plan\.ts#L1\)/,
    );
  });

  it("renders plain locations when no source URL base is provided", () => {
    const markdown = renderPrComment(makeResult([propIssue]));

    assert.match(markdown, /at `src\/Parent\.tsx:13`/);
    assert.doesNotMatch(markdown, /blob\/abc123/);
  });

  it("renders a clean empty state", () => {
    const markdown = renderPrComment(makeResult([]));

    assert.match(markdown, /No maintainability debt found at the configured severity level\./);
    assert.doesNotMatch(markdown, /Grouped annotations/);
  });
});
