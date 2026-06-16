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
    assert.equal(result.suppressions[0]?.kind, "next-line");
    assert.equal(result.suppressions[0]?.reason, "tracked in JIRA-1");
    assert.equal(result.suppressions[0]?.directiveLine, 1);
    assert.equal(result.suppressions[0]?.targetLine, 2);
    assert.equal(result.suppressions[0]?.issue.ruleId, "todo-comment");
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

  it("suggests the closest rule id for an unknown suppression rule", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comments -- reason\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.match(result.warnings[0] ?? "", /did you mean "todo-comment"\?/);
  });

  it("suppresses file-level findings for the configured rule", () => {
    const files = [file("src/a.ts", "// debtlens-disable-file naming-drift -- domain vocabulary is intentional\nconst movie = 1;\n")];
    const result = applyInlineSuppressions([
      issue({ ruleId: "naming-drift", ruleName: "Naming drift", location: { startLine: 2 } }),
    ], files, validRuleIds);
    assert.equal(result.issues.length, 0);
    assert.equal(result.suppressedByInline, 1);
    assert.equal(result.suppressions[0]?.kind, "file");
    assert.equal(result.suppressions[0]?.reason, "domain vocabulary is intentional");
  });

  it("does not suppress a different rule on the suppressed line", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comment -- tracked in JIRA-1\nconst movie = 1;\n")];
    const result = applyInlineSuppressions([
      issue({ ruleId: "todo-comment", location: { startLine: 2 } }),
      issue({ ruleId: "naming-drift", ruleName: "Naming drift", location: { startLine: 2 } }),
    ], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0]?.ruleId, "naming-drift");
    assert.equal(result.suppressedByInline, 1);
  });
});
