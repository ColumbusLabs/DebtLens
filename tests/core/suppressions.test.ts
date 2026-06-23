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
    language: relativePath.endsWith(".py") ? "python" : "tsjs",
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
    assert.equal(result.suppressionDirectives[0]?.status, "used");
    assert.equal(result.suppressionDirectives[0]?.suppressedIssueCount, 1);
    assert.equal(result.suppressionDirectives[0]?.recommendedAction, "Keep this suppression only while the documented exception remains valid.");
  });

  it("audits unused next-line suppressions", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comment -- stale exception\nexport const x = 1;\n")];
    const result = applyInlineSuppressions([], files, validRuleIds);

    assert.equal(result.suppressionDirectives.length, 1);
    assert.equal(result.suppressionDirectives[0]?.status, "unused");
    assert.equal(result.suppressionDirectives[0]?.kind, "next-line");
    assert.equal(result.suppressionDirectives[0]?.file, "src/a.ts");
    assert.equal(result.suppressionDirectives[0]?.directiveLine, 1);
    assert.equal(result.suppressionDirectives[0]?.targetLine, 2);
    assert.equal(result.suppressionDirectives[0]?.ruleId, "todo-comment");
    assert.equal(result.suppressionDirectives[0]?.reason, "stale exception");
    assert.equal(result.suppressionDirectives[0]?.suppressedIssueCount, 0);
    assert.equal(result.suppressionDirectives[0]?.recommendedAction, "Remove this suppression if the finding no longer exists.");
  });

  it("marks directives for unrun rules as not evaluated", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line naming-drift -- domain term\nconst ok = true;\n")];
    const result = applyInlineSuppressions([], files, validRuleIds, new Set(["todo-comment"]));

    assert.equal(result.suppressionDirectives.length, 1);
    assert.equal(result.suppressionDirectives[0]?.status, "not-evaluated");
    assert.equal(result.suppressionDirectives[0]?.ruleId, "naming-drift");
    assert.equal(result.suppressionDirectives[0]?.suppressedIssueCount, 0);
    assert.match(result.suppressionDirectives[0]?.recommendedAction ?? "", /Run this rule/);
  });

  it("does not suppress when the reason is missing", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line todo-comment\nexport const x = 1;\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.match(result.warnings[0] ?? "", /reason is missing/);
    assert.equal(result.suppressionDirectives.length, 0);
  });

  it("does not honor suppression text inside string literals", () => {
    const files = [file("src/a.ts", "const text = \"debtlens-disable-file todo-comment -- not a comment\";\n// TODO still reported\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);

    assert.equal(result.issues.length, 1);
    assert.equal(result.suppressedByInline, 0);
    assert.equal(result.suppressionDirectives.length, 0);
  });

  it("does not honor suppression text inside template literals", () => {
    const files = [file("src/a.ts", "const text = `debtlens-disable-next-line todo-comment -- not a comment`;\n// TODO still reported\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);

    assert.equal(result.issues.length, 1);
    assert.equal(result.suppressedByInline, 0);
    assert.equal(result.suppressionDirectives.length, 0);
  });

  it("warns on unknown rule ids", () => {
    const files = [file("src/a.ts", "// debtlens-disable-next-line made-up-rule -- reason\n")];
    const result = applyInlineSuppressions([issue()], files, validRuleIds);
    assert.equal(result.issues.length, 1);
    assert.match(result.warnings[0] ?? "", /unknown suppression rule/);
    assert.equal(result.suppressionDirectives.length, 0);
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
      issue({ id: "dl_test_2", ruleId: "naming-drift", ruleName: "Naming drift", location: { startLine: 3 } }),
    ], files, validRuleIds);
    assert.equal(result.issues.length, 0);
    assert.equal(result.suppressedByInline, 2);
    assert.equal(result.suppressions[0]?.kind, "file");
    assert.equal(result.suppressions[0]?.reason, "domain vocabulary is intentional");
    assert.equal(result.suppressionDirectives[0]?.kind, "file");
    assert.equal(result.suppressionDirectives[0]?.status, "used");
    assert.equal(result.suppressionDirectives[0]?.suppressedIssueCount, 2);
    assert.match(result.suppressionDirectives[0]?.recommendedAction ?? "", /file-wide suppression can be narrowed/);
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
