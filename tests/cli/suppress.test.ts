import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runSuppress } from "../../src/cli/suppress.js";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";

describe("debtlens suppress", () => {
  it("prints a next-line suppression directive", () => {
    const output = runSuppress({ ruleId: "todo-comment", reason: "tracked in JIRA-123" });
    assert.equal(output, "// debtlens-disable-next-line todo-comment -- tracked in JIRA-123\n");
  });

  it("prints a file-level suppression directive with --file", () => {
    const output = runSuppress({ ruleId: "naming-drift", reason: "domain vocabulary is intentional", file: true });
    assert.equal(output, "// debtlens-disable-file naming-drift -- domain vocabulary is intentional\n");
  });

  it("normalizes rule id casing", () => {
    const output = runSuppress({ ruleId: "TODO-Comment", reason: "why" });
    assert.match(output, /debtlens-disable-next-line todo-comment -- why/);
  });

  it("rejects unknown rules with a suggestion", () => {
    assert.throws(
      () => runSuppress({ ruleId: "todo-coment", reason: "why" }),
      /Unknown DebtLens rule "todo-coment"\. Did you mean "todo-comment"\?/,
    );
  });

  it("rejects empty reasons", () => {
    assert.throws(
      () => runSuppress({ ruleId: "todo-comment", reason: "   " }),
      /non-empty --reason is required/,
    );
  });

  it("emits directives the scanner actually honors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-suppress-"));
    try {
      mkdirSync(join(dir, "src"));
      const directive = runSuppress({ ruleId: "todo-comment", reason: "tracked in JIRA-123" });
      writeFileSync(join(dir, "src", "app.ts"), `${directive}// TODO fix later\nexport const value = 1;\n`);

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
      });

      assert.equal(result.summary.totalIssues, 0);
      assert.equal(result.summary.filterStats?.suppressedByInline, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
