import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { mergeConfig } from "../../src/config/mergeConfig.js";
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

  it("applies Next pack duplicated-literal ignores during a scan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-next-literals-"));
    try {
      mkdirSync(join(dir, "app", "dashboard"), { recursive: true });
      mkdirSync(join(dir, "app", "settings"), { recursive: true });
      mkdirSync(join(dir, "app", "reports"), { recursive: true });
      writeFileSync(join(dir, "app", "dashboard", "ClientOne.tsx"), `"use client";
export function ClientOne() {
  return <button>One</button>;
}
`);
      writeFileSync(join(dir, "app", "settings", "ClientTwo.tsx"), `"use client";
export function ClientTwo() {
  return <button>Two</button>;
}
`);
      writeFileSync(join(dir, "app", "reports", "ClientThree.tsx"), `"use client";
export function ClientThree() {
  return <button>Three</button>;
}
`);

      const result = await scan(mergeConfig(".", { pack: "next" }, {
        cwd: dir,
        rules: ["duplicated-literal"],
      }));

      assert.equal(result.summary.filesScanned, 3);
      assert.equal(result.summary.rulesRun, 1);
      assert.equal(result.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies ruleSeverities overrides to reported issues and summary counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-severities-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO fix later\nexport const value = 1;\n");

      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
      };

      const result = await scan({ ...baseOptions, ruleSeverities: { "todo-comment": "high" } });

      assert.equal(result.summary.totalIssues, 1);
      assert.equal(result.issues[0]?.severity, "high");
      assert.equal(result.summary.bySeverity.high, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("filters issues below a per-rule confidence floor and tracks filterStats", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-confidence-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO fix later\nexport const value = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        ruleConfidenceFloors: { "todo-comment": 1 },
      });

      assert.equal(result.summary.totalIssues, 0);
      assert.equal(result.summary.filterStats?.filteredByConfidenceFloor, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns on unknown rule ids in per-rule overrides with a suggestion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-unknown-rule-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "info",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        maxFiles: defaultConfig.maxFiles,
        ruleSeverities: { "todo-coment": "info" },
        ruleConfidenceFloors: { "prop-driling": 0.5 },
      });

      const warnings = result.summary.warnings ?? [];
      assert.ok(warnings.some((warning) => warning.includes('ruleSeverities: unknown rule "todo-coment" (did you mean "todo-comment"?)')));
      assert.ok(warnings.some((warning) => warning.includes('ruleConfidenceFloors: unknown rule "prop-driling" (did you mean "prop-drilling"?)')));
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
