import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderPrComment } from "../../src/reporters/prCommentReporter.js";

function makeResult(issues: ScanResult["issues"]): ScanResult {
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

const propIssue: ScanResult["issues"][number] = {
  id: "dl_pr_1",
  fingerprint: "dl_pr_1",
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

const stateIssue: ScanResult["issues"][number] = {
  id: "dl_pr_2",
  fingerprint: "dl_pr_2",
  ruleId: "state-sprawl",
  ruleName: "State sprawl",
  severity: "medium",
  confidence: 0.82,
  message: "Parent manages 7 stateful hook calls.",
  file: "src/Parent.tsx",
  location: { startLine: 24 },
  tags: ["react"],
};

const namingIssue: ScanResult["issues"][number] = {
  id: "dl_pr_3",
  fingerprint: "dl_pr_3",
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
    assert.match(markdown, /### Fix these first/);
    assert.match(markdown, /`src\/Parent\.tsx` - 2 findings, 2 rules:/);
    assert.match(markdown, /<details><summary><code>src\/Parent\.tsx<\/code> - 2 findings<\/summary>/);
    assert.match(markdown, /- \*\*High\*\* Prop drilling \(`prop-drilling`\) at `src\/Parent\.tsx:13`: Parent forwards/);
    assert.match(markdown, /  - Confidence: \*\*73%\*\*/);
    assert.match(markdown, /  - Evidence: Child: a, b, c, d, e/);
    assert.match(markdown, /  - Suggestion: Consider colocating/);
    assert.match(markdown, /- \*\*Medium\*\* State sprawl \(`state-sprawl`\) at `src\/Parent\.tsx:24`: Parent manages/);
    assert.match(markdown, /<details><summary><code>src\/release plan\.ts<\/code> - 1 finding<\/summary>/);
  });

  it("discloses a payoff-selected report view and its full-scan gate semantics", () => {
    const result = makeResult([{ ...propIssue, payoffScore: 12 }]);
    result.summary.issueSelection = {
      strategy: "payoff",
      limit: 1,
      totalAvailable: 4,
      omitted: 3,
    };

    const markdown = renderPrComment(result);

    assert.match(markdown, /Showing 1 of 4 findings ranked by payoff/);
    assert.match(markdown, /gates and baseline writes use the full scan/);
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

  it("renders a clean empty delta state", () => {
    const result = makeResult([]);
    result.summary.deltaFromBaseline = {
      new: 0,
      resolved: 2,
      changed: 0,
      severityRegressions: 0,
      totalDelta: -2,
      baseline: { totalIssues: 2, bySeverity: { info: 0, low: 0, medium: 0, high: 2 }, byRule: { "prop-drilling": 2 } },
      current: { totalIssues: 0, bySeverity: { info: 0, low: 0, medium: 0, high: 0 }, byRule: {} },
      hasBaselineSummary: true,
      byRule: { "prop-drilling": { baseline: 2, current: 0, delta: -2 } },
    };

    const markdown = renderPrComment(result, { deltaOnly: true, maxFindings: 20 });

    assert.match(markdown, /Delta: -2 total, 0 new, 2 resolved, 0 changed/);
    assert.match(markdown, /No new findings versus the compared baseline\./);
    assert.doesNotMatch(markdown, /No maintainability debt found/);
    assert.doesNotMatch(markdown, /Omitted finding summary|Grouped annotations/);
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

  it("renders suppression audits before the empty state", () => {
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
    }];

    const markdown = renderPrComment(result);

    assert.match(markdown, /### Suppression audit/);
    assert.match(markdown, /1 directive \| 1 unused \| 0 not evaluated \| 0 file-wide \| 1 next-line \| 0 hidden findings/);
    assert.match(markdown, /\| unused \| next-line \| `src\/Widget\.ts:4` \| `todo-comment` \| 0 \| stale exception \| Remove this suppression/);
    assert.match(markdown, /No maintainability debt found at the configured severity level\./);
  });

  it("renders optional git churn hotspots", () => {
    const result = makeResult([propIssue]);
    result.summary.hotspots = {
      source: "git",
      window: { range: "origin/main..HEAD" },
      ranking: [{
        file: "src/Parent.tsx",
        repositoryPath: "src/Parent.tsx",
        totalIssues: 1,
        distinctRules: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
        score: 27.4,
        churn: { file: "src/Parent.tsx", repositoryPath: "src/Parent.tsx", commits: 3, additions: 20, deletions: 4, changedLines: 24 },
        reasons: ["1 high-severity finding", "3 recent commits"],
        topRules: [{ ruleId: "prop-drilling", count: 1 }],
      }],
    };

    const markdown = renderPrComment(result);

    assert.match(markdown, /### Git churn hotspots/);
    assert.match(markdown, /Optional git-derived ranking from git range `origin\/main\.\.HEAD`/);
    assert.match(markdown, /`src\/Parent\.tsx` - score 27\.4, 3 commits, 24 changed lines/);
  });

  it("renders optional CODEOWNERS ownership handoffs", () => {
    const result = makeResult([propIssue]);
    result.summary.ownership = {
      source: "codeowners",
      codeownersPath: ".github/CODEOWNERS",
      files: [],
      ownerSummaries: [{
        owner: "@frontend/team",
        files: 1,
        totalIssues: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
        topFiles: [{ file: "src/Parent.tsx", totalIssues: 1, score: 21 }],
      }],
      handoffs: [],
      unownedHotspots: [{
        file: "src/Orphan.ts",
        repositoryPath: "src/Orphan.ts",
        owners: [],
        totalIssues: 2,
        distinctRules: 2,
        bySeverity: { info: 0, low: 1, medium: 1, high: 0 },
        score: 20,
        reasons: ["1 medium-severity finding"],
        topRules: [{ ruleId: "todo-comment", count: 1 }],
      }],
    };

    const markdown = renderPrComment(result);

    assert.match(markdown, /### Ownership handoffs/);
    assert.match(markdown, /@frontend\/team: 1 finding across 1 file; top files: src\/Parent\.tsx \(1\)/);
    assert.match(markdown, /Unowned high-debt files: src\/Orphan\.ts \(2\)/);
  });

  it("caps detailed findings and summarizes omitted findings with a full report link", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue, namingIssue]), {
      maxFindings: 1,
      artifactLink: "https://github.com/example/actions/runs/1/artifacts/2",
    });

    assert.match(markdown, /### Omitted finding summary/);
    assert.match(markdown, /2 findings omitted from detailed annotations/);
    assert.match(markdown, /Severity: high 0, medium 1, low 0, info 1\./);
    assert.match(markdown, /Top rules: naming-drift \(1\), state-sprawl \(1\)\./);
    assert.match(markdown, /Full details: https:\/\/github\.com\/example\/actions\/runs\/1\/artifacts\/2\./);
    assert.match(markdown, /Prop drilling/);
    assert.doesNotMatch(markdown, /State sprawl \(`state-sprawl`\) at/);
    assert.doesNotMatch(markdown, /Naming drift \(`naming-drift`\) at/);
  });

  it("selects top-N detailed findings by existing payoff score", () => {
    const lowPayoffHighSeverity = { ...propIssue, payoffScore: 3 };
    const highPayoffInfoSeverity = { ...namingIssue, payoffScore: 40 };
    const mediumPayoff = { ...stateIssue, payoffScore: 12 };

    const markdown = renderPrComment(
      makeResult([lowPayoffHighSeverity, mediumPayoff, highPayoffInfoSeverity]),
      { maxFindings: 1 },
    );

    assert.match(markdown, /Naming drift \(`naming-drift`\) at/);
    assert.doesNotMatch(markdown, /Prop drilling \(`prop-drilling`\) at/);
    assert.doesNotMatch(markdown, /State sprawl \(`state-sprawl`\) at/);
    assert.match(markdown, /The 1 detailed finding shown was selected by payoff score before applying the cap\./);
  });

  it("attributes omitted findings to the finding cap when a byte cap is also configured", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue, namingIssue]), {
      maxFindings: 1,
      maxBytes: 60000,
    });

    assert.match(markdown, /configured 1-finding detail cap/);
    assert.doesNotMatch(markdown, /configured 60000-byte comment cap/);
  });

  it("counts omitted occurrences separately when findings share an id", () => {
    const repeatedStateIssue = { ...stateIssue, id: propIssue.id, fingerprint: propIssue.id };
    const markdown = renderPrComment(makeResult([propIssue, repeatedStateIssue, namingIssue]), {
      maxFindings: 1,
    });

    assert.match(markdown, /2 findings omitted from detailed annotations/);
    assert.match(markdown, /Severity: high 0, medium 1, low 0, info 1\./);
    assert.match(markdown, /Top rules: naming-drift \(1\), state-sprawl \(1\)\./);
  });

  it("omits grouped annotations cleanly when the finding cap is zero", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue]), { maxFindings: 0 });

    assert.match(markdown, /Detailed annotations are omitted from this comment/);
    assert.doesNotMatch(markdown, /### Grouped annotations/);
  });

  it("reduces detailed findings until the comment fits a byte cap", () => {
    const issues = Array.from({ length: 8 }, (_, index) => ({
      ...propIssue,
      id: `long-${index}`,
      file: `src/Long${index}.tsx`,
      message: `Long issue ${index} ${"x".repeat(300)}`,
    }));
    const markdown = renderPrComment(makeResult(issues), { maxBytes: 2200 });

    assert.ok(new TextEncoder().encode(markdown).length <= 2200);
    assert.match(markdown, /### Omitted finding summary/);
    assert.match(markdown, /configured 2200-byte comment cap/);
  });

  it("explains payoff selection when the byte cap truncates detailed findings", () => {
    const issues = Array.from({ length: 8 }, (_, index) => ({
      ...propIssue,
      id: `payoff-long-${index}`,
      fingerprint: `payoff-long-${index}`,
      file: `src/PayoffLong${index}.tsx`,
      message: `Long issue ${index} ${"x".repeat(300)}`,
      payoffScore: index + 1,
    }));
    const markdown = renderPrComment(makeResult(issues), { maxBytes: 2200 });

    assert.match(markdown, /selected by payoff score before applying the cap/);
    assert.match(markdown, /configured 2200-byte comment cap/);
  });

  it("falls back to a minimal truncated comment when fixed sections exceed the byte cap", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue, namingIssue]), {
      maxBytes: 180,
      artifactLink: `https://example.test/${"x".repeat(1000)}`,
    });

    assert.ok(new TextEncoder().encode(markdown).length <= 180);
    assert.match(markdown, /^<!-- debtlens-report -->/);
    assert.match(markdown, /Comment truncated|Detailed annotations are omitted/);
    assert.doesNotMatch(markdown, /### Grouped annotations/);
  });

  it("keeps truncated fallback comments within byte caps for multibyte text", () => {
    const markdown = renderPrComment(makeResult([propIssue, stateIssue, namingIssue]), {
      maxBytes: 287,
      artifactLink: `https://example.test/${"😀".repeat(400)}`,
    });

    assert.ok(new TextEncoder().encode(markdown).length <= 287);
  });
});
