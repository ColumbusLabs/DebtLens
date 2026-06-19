import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult } from "../../src/core/types.js";
import { renderGitLabCodeQuality } from "../../src/reporters/gitlabCodeQualityReporter.js";

describe("gitlab-codequality reporter", () => {
  it("maps findings into GitLab Code Quality fields", () => {
    const parsed = JSON.parse(renderGitLabCodeQuality(makeResult())) as Array<{
      description: string;
      check_name: string;
      fingerprint: string;
      severity: string;
      location: { path: string; lines: { begin: number } };
    }>;

    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed[0], {
      description: "High issue",
      check_name: "prop-drilling",
      fingerprint: "stable-high",
      severity: "critical",
      location: {
        path: "src/High.tsx",
        lines: { begin: 4 },
      },
    });
    assert.equal(parsed[1]?.severity, "major");
    assert.equal(parsed[2]?.severity, "minor");
    assert.equal(parsed[3]?.severity, "info");
    assert.equal(parsed[3]?.fingerprint, "info-id");
    assert.equal(parsed[3]?.location.lines.begin, 1);
  });

  it("prefixes target-relative findings with the repository-relative target", () => {
    const result = makeResult();
    result.options.target = resolve("examples/react");
    result.issues = [{
      ...result.issues[0]!,
      file: "src/Dashboard.tsx",
      location: { startLine: 22 },
    }];
    const [finding] = JSON.parse(renderGitLabCodeQuality(result));

    assert.equal(finding.location.path, "examples/react/src/Dashboard.tsx");
    assert.equal(finding.location.lines.begin, 22);
  });
});

function makeResult(): ScanResult {
  const issues: DebtIssue[] = [{
    id: "high-id",
    fingerprint: "stable-high",
    ruleId: "prop-drilling",
    ruleName: "Prop drilling",
    severity: "high",
    confidence: 0.9,
    message: "High issue",
    file: "./src/High.tsx",
    location: { startLine: 4 },
    tags: [],
  }, {
    id: "medium-id",
    ruleId: "large-function",
    ruleName: "Large function",
    severity: "medium",
    confidence: 0.8,
    message: "Medium issue",
    file: "src\\Medium.ts",
    location: { startLine: 12 },
    tags: [],
  }, {
    id: "low-id",
    ruleId: "todo-comment",
    ruleName: "Todo comment",
    severity: "low",
    confidence: 0.7,
    message: "Low issue",
    file: "src/Low.ts",
    location: { startLine: 20 },
    tags: [],
  }, {
    id: "info-id",
    ruleId: "naming-drift",
    ruleName: "Naming drift",
    severity: "info",
    confidence: 0.6,
    message: "Info issue",
    file: "src/Info.ts",
    tags: [],
  }];

  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity: { high: 1, medium: 1, low: 1, info: 1 },
      byRule: {
        "prop-drilling": 1,
        "large-function": 1,
        "todo-comment": 1,
        "naming-drift": 1,
      },
      filesScanned: 4,
      rulesRun: 4,
      elapsedMs: 10,
    },
    options: {
      target: ".",
      include: [],
      exclude: [],
      minSeverity: "info",
    },
  };
}
