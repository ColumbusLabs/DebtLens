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
