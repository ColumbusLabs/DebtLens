import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGitChurnHotspots } from "../../src/core/hotspots.js";
import type { DebtIssue, Severity } from "../../src/core/types.js";

function issue(file: string, severity: Severity, ruleId = "todo-comment"): DebtIssue {
  return {
    id: `${file}-${severity}-${ruleId}`,
    ruleId,
    ruleName: ruleId,
    severity,
    confidence: 0.9,
    message: "test finding",
    file,
    tags: [],
  };
}

describe("buildGitChurnHotspots", () => {
  it("ranks debt by issue severity and recent churn", () => {
    const summary = buildGitChurnHotspots({
      issues: [
        issue("src/stable.ts", "high"),
        issue("src/hot.ts", "medium"),
        issue("src/hot.ts", "medium", "state-sprawl"),
      ],
      churn: [{
        file: "src/hot.ts",
        repositoryPath: "src/hot.ts",
        commits: 8,
        additions: 120,
        deletions: 30,
        changedLines: 150,
      }],
      window: { days: 90, since: "2026-03-21" },
    });

    assert.equal(summary?.source, "git");
    assert.equal(summary?.ranking[0]?.file, "src/hot.ts");
    assert.deepEqual(summary?.ranking[0]?.topRules, [
      { ruleId: "state-sprawl", count: 1 },
      { ruleId: "todo-comment", count: 1 },
    ]);
    assert.match(summary?.ranking[0]?.reasons.join("; ") ?? "", /8 recent commits/);
    assert.match(summary?.ranking[0]?.reasons.join("; ") ?? "", /150 changed lines/);
    assert.equal(summary?.ranking[1]?.file, "src/stable.ts");
    assert.equal(summary?.ranking[1]?.churn.changedLines, 0);
  });

  it("matches churn by repository path for package-scoped issue files", () => {
    const summary = buildGitChurnHotspots({
      issues: [issue("src/App.tsx", "high")],
      churn: [{
        file: "packages/web/src/App.tsx",
        repositoryPath: "packages/web/src/App.tsx",
        commits: 2,
        additions: 8,
        deletions: 4,
        changedLines: 12,
      }],
      fileToRepositoryPath: new Map([["src/App.tsx", "packages/web/src/App.tsx"]]),
      window: { range: "origin/main...HEAD" },
    });

    assert.equal(summary?.window.range, "origin/main...HEAD");
    assert.equal(summary?.ranking[0]?.file, "src/App.tsx");
    assert.equal(summary?.ranking[0]?.repositoryPath, "packages/web/src/App.tsx");
    assert.equal(summary?.ranking[0]?.churn.commits, 2);
  });

  it("omits empty hotspot summaries", () => {
    assert.equal(buildGitChurnHotspots({ issues: [], churn: [], window: { days: 90 } }), undefined);
  });
});
