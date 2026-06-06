import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";

describe("scan integration", () => {
  it("runs the full pipeline against examples/react", async () => {
    const cwd = process.cwd();
    const result = await scan({
      cwd,
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: [],
      minSeverity: "medium",
      rules: ["duplicate-logic", "prop-drilling"],
      thresholds: {},
      maxFiles: defaultConfig.maxFiles,
    });

    assert.equal(result.summary.filesScanned, 3);
    assert.equal(result.summary.rulesRun, 2);
    assert.equal(result.summary.totalIssues, 2);
    assert.equal(result.summary.bySeverity.high, 2);
    assert.deepEqual(result.summary.byRule, {
      "prop-drilling": 1,
      "duplicate-logic": 1,
    });

    assert.deepEqual(result.issues.map((issue) => issue.ruleId), ["prop-drilling", "duplicate-logic"]);
    assert.equal(result.issues[0]?.severity, "high");
    assert.equal(result.issues[0]?.file, "src/Dashboard.tsx");
    assert.equal(result.issues[1]?.severity, "high");
    assert.equal(result.issues[1]?.file, "src/duplicateOne.ts");
  });

  it("only filters .gitignore matches when respectGitignore is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-gitignore-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO ignored\nexport const ignored = 1;\n");
      writeFileSync(join(dir, "src", "kept.ts"), "// TODO kept\nexport const kept = 1;\n");

      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
      };

      const defaultResult = await scan(baseOptions);
      const filteredResult = await scan({ ...baseOptions, respectGitignore: true });

      assert.equal(defaultResult.summary.totalIssues, 2);
      assert.equal(filteredResult.summary.totalIssues, 1);
      assert.deepEqual(filteredResult.issues.map((issue) => issue.file), ["src/kept.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps scanning outside git repos when respectGitignore is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-plain-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO still scanned outside git\nexport const ignored = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        respectGitignore: true,
      });

      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.file, "src/ignored.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
