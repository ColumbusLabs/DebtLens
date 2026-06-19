import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { renderMarkdown } from "../../src/reporters/markdownReporter.js";

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
      filesScanned: 1,
      rulesRun: 8,
      elapsedMs: 12,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

const issue: DebtIssue = {
  id: "dl_test",
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

describe("markdown reporter", () => {
  it("renders header, summary, severity section, evidence, and suggestion", () => {
    const md = renderMarkdown(makeResult([issue]));
    assert.match(md, /^# DebtLens Report/);
    assert.match(md, /Scanned \*\*1\*\* files with \*\*8\*\* rules/);
    assert.match(md, /- Total issues: \*\*1\*\*/);
    assert.match(md, /## Fix these first/);
    assert.match(md, /\| `src\/Parent\.tsx` \| 1 high-severity finding \| prop-drilling \(1\) \|/);
    assert.match(md, /## High severity/);
    assert.match(md, /### Prop drilling — `src\/Parent\.tsx:13`/);
    assert.match(md, /Confidence: \*\*73%\*\*/);
    assert.match(md, /- Child: a, b, c, d, e/);
    assert.match(md, /Suggestion: Consider colocating/);
  });

  it("renders a clean empty-state message when there are no issues", () => {
    const md = renderMarkdown(makeResult([]));
    assert.match(md, /No maintainability debt found/);
    assert.doesNotMatch(md, /## High severity/);
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

    const md = renderMarkdown(result);

    assert.match(md, /## Suppression audit/);
    assert.match(md, /1 directive \| 1 unused \| 0 not evaluated \| 0 file-wide \| 1 next-line \| 0 hidden findings/);
    assert.match(md, /\| unused \| next-line \| `src\/Widget\.ts:4` \| `todo-comment` \| 0 \| stale exception \| Remove this suppression/);
    assert.match(md, /No maintainability debt found/);
  });

  it("renders correlations and an opt-in debt heatmap", () => {
    const result = makeResult([
      issue,
      {
        ...issue,
        id: "dl_state",
        ruleId: "state-sprawl",
        ruleName: "State sprawl",
        severity: "medium",
        message: "Parent manages too much state.",
      },
    ]);
    result.summary.correlations = [{
      file: "src/Parent.tsx",
      totalIssues: 2,
      rules: [
        { ruleId: "prop-drilling", ruleName: "Prop drilling", count: 1 },
        { ruleId: "state-sprawl", ruleName: "State sprawl", count: 1 },
      ],
    }];

    const md = renderMarkdown(result, { heatmapLimit: 5 });

    assert.match(md, /## Rule correlations/);
    assert.match(md, /\| `src\/Parent\.tsx` \| prop-drilling \(1\), state-sprawl \(1\) \| 2 \|/);
    assert.match(md, /## Debt heatmap/);
  });

  it("renders fix targets with duplicate cluster reasons", () => {
    const result = makeResult([
      { ...issue, ruleId: "duplicate-logic", ruleName: "Duplicate logic", severity: "medium", file: "src/a.ts" },
      { ...issue, id: "dl_test_2", ruleId: "state-sprawl", ruleName: "State sprawl", severity: "medium", file: "src/a.ts" },
    ]);
    result.summary.duplicateClusters = [{
      clusterId: "dup_test",
      issueCount: 1,
      locations: [
        { file: "src/a.ts", startLine: 10, endLine: 20 },
        { file: "src/b.ts", startLine: 30, endLine: 40 },
      ],
    }];

    const md = renderMarkdown(result);

    assert.match(md, /## Fix these first/);
    assert.match(md, /\| `src\/a\.ts` \| 2 medium-severity findings; 2 distinct rules; 1 duplicate cluster \|/);
  });

  it("renders duplicate logic clusters", () => {
    const result = makeResult([{ ...issue, ruleId: "duplicate-logic", ruleName: "Duplicate logic" }]);
    result.summary.duplicateClusters = [{
      clusterId: "dup_test",
      issueCount: 2,
      locations: [
        { file: "src/a.ts", startLine: 10, endLine: 20 },
        { file: "src/b.ts", startLine: 30, endLine: 40 },
      ],
    }];

    const md = renderMarkdown(result);

    assert.match(md, /## Duplicate logic clusters/);
    assert.match(md, /\| `dup_test` \| 2 \| src\/a\.ts:10-20, src\/b\.ts:30-40 \|/);
  });

  it("renders optional git churn hotspots", () => {
    const result = makeResult([issue]);
    result.summary.hotspots = {
      source: "git",
      window: { days: 14, since: "2026-06-05T00:00:00.000Z" },
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

    const md = renderMarkdown(result);

    assert.match(md, /## Git churn hotspots/);
    assert.match(md, /Optional git-derived ranking from the last 14 days/);
    assert.match(md, /\| `src\/Parent\.tsx` \| 27\.4 \| 3 commits, 24 changed lines \|/);
  });

  it("renders optional CODEOWNERS ownership handoffs", () => {
    const result = makeResult([issue]);
    result.summary.ownership = {
      source: "codeowners",
      codeownersPath: ".github/CODEOWNERS",
      files: [{
        file: "src/Parent.tsx",
        repositoryPath: "src/Parent.tsx",
        owners: ["@frontend/team"],
        totalIssues: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
        matchedPattern: "src/",
        matchedLine: 2,
      }],
      ownerSummaries: [{
        owner: "@frontend/team",
        files: 1,
        totalIssues: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
        topFiles: [{ file: "src/Parent.tsx", totalIssues: 1, score: 21 }],
      }],
      handoffs: [{
        file: "src/Parent.tsx",
        repositoryPath: "src/Parent.tsx",
        owners: ["@frontend/team"],
        totalIssues: 1,
        distinctRules: 1,
        bySeverity: { info: 0, low: 0, medium: 0, high: 1 },
        score: 21,
        reasons: ["1 high-severity finding"],
        topRules: [{ ruleId: "prop-drilling", count: 1 }],
        matchedPattern: "src/",
        matchedLine: 2,
      }],
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

    const md = renderMarkdown(result);

    assert.match(md, /## Ownership handoffs/);
    assert.match(md, /CODEOWNERS source: `.github\/CODEOWNERS`/);
    assert.match(md, /\| @frontend\/team \| 1 \| 1 \| src\/Parent\.tsx \(1\) \|/);
    assert.match(md, /### Unowned high-debt files/);
    assert.match(md, /\| `src\/Orphan\.ts` \| 20 \|/);
  });

  it("escapes Markdown table cells in correlations and heatmaps", () => {
    const result = makeResult([{ ...issue, file: "src/a|b.tsx\n" }]);
    result.summary.correlations = [{
      file: "src/a|b.tsx\n",
      totalIssues: 2,
      rules: [{ ruleId: "rule|id", ruleName: "Rule", count: 2 }],
    }];

    const md = renderMarkdown(result, { heatmapLimit: 1 });

    assert.match(md, /`src\/a\\\|b\.tsx`/);
    assert.match(md, /rule\\\|id \(2\)/);
  });

  it("matches the examples/react report fixture", async () => {
    const result = await scan({
      cwd: process.cwd(),
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: defaultConfig.exclude,
      minSeverity: "low",
      rules: undefined,
      thresholds: defaultConfig.thresholds,
      maxFiles: defaultConfig.maxFiles,
      respectGitignore: defaultConfig.respectGitignore,
    });
    const fixture = readFileSync("docs/example-report.md", "utf8");

    assert.equal(normalizeReport(renderMarkdown(result)), normalizeReport(fixture));
  });
});

function normalizeReport(markdown: string): string {
  return markdown
    .replace(/in \*\*\d+ms\*\*/g, "in **<elapsed>ms**")
    .replace(/^Review prompt: .+\n\n/gm, "")
    .replace(/\n+$/g, "\n");
}
