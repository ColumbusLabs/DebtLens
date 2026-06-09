import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyInlineSuppressions } from "../../src/core/suppressions.js";
import type { DebtIssue, SourceFileInfo } from "../../src/core/types.js";

const validRuleIds = new Set(["todo-comment", "naming-drift"]);

function file(relativePath: string, content: string): SourceFileInfo {
  return {
    absolutePath: `/${relativePath}`,
    relativePath,
    content,
    sourceFile: {} as SourceFileInfo["sourceFile"],
  };
}

function issue(overrides: Partial<DebtIssue> = {}): DebtIssue {
  return {
    id: "dl_test",
    ruleId: "todo-comment",
    ruleName: "Todo comment",
    severity: "low",
    confidence: 0.9,
    message: "Comment contains a todo marker.",
    file: "src/a.ts",
    location: { startLine: 2 },
    tags: [],
    ...overrides,
  };
}

describe("inline suppressions", () => {
  it("suppresses a matching next-line finding with a reason", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comment -- tracked in JIRA-1\nexport const x = 1;\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 0);
    assert.equal(result.suppressedByInline, 1);
  });

  it("does not suppress when the reason is missing", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comment\nexport const x = 1;\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.match(result.warnings[0] ?? "", /reason is missing/);
  });

  it("warns on unknown rule ids", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line made-up-rule -- reason\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.match(result.warnings[0] ?? "", /unknown suppression rule/);
  });

  it("suppresses file-level findings for the configured rule", () => {
    const files = [file("src/a.ts", "// debtlens-disable-file naming-drift -- domain vocabulary is intentional\nconst movie = 1;\n")];
    const result = applyInlineSuppressions([
      issue({ ruleId: "naming-drift", ruleName: "Naming drift", location: { startLine: 2 } }),
    ], files, validRuleIds);
    assert.equal(result.issues.length, 0);
    assert.equal(result.suppressedByInline, 1);
  });
});
