import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";
import type { Detector } from "../../src/core/types.js";

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

  it("reuses unchanged scan results from the content-hash cache and invalidates on edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-cache-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO first pass\nexport const value = 1;\n");
      const cachePath = join(dir, ".debtlens", "cache.json");
      const options = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        cache: true,
        cachePath,
      };

      const first = await scan(options);
      const second = await scan(options);
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");
      const third = await scan(options);

      assert.equal(existsSync(cachePath), true);
      assert.equal(first.summary.totalIssues, 1);
      assert.equal(first.summary.performance?.cache?.hit, false);
      assert.equal(second.summary.totalIssues, 1);
      assert.equal(second.summary.performance?.cache?.hit, true);
      assert.equal(third.summary.totalIssues, 0);
      assert.equal(third.summary.performance?.cache?.hit, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps profile cache entries separate from non-profile cache entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-cache-profile-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "// TODO first pass\nexport const value = 1;\n");
      const cachePath = join(dir, ".debtlens", "cache.json");
      const options = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        cache: true,
        cachePath,
      };

      const withoutProfile = await scan(options);
      const withProfile = await scan({ ...options, profile: true });
      const withProfileAgain = await scan({ ...options, profile: true });

      assert.equal(withoutProfile.summary.performance?.cache?.hit, false);
      assert.equal(withoutProfile.summary.profile, undefined);
      assert.equal(withProfile.summary.performance?.cache?.hit, false);
      assert.ok(withProfile.summary.profile?.ruleTimingsMs["todo-comment"] !== undefined);
      assert.equal(withProfileAgain.summary.performance?.cache?.hit, true);
      assert.ok(withProfileAgain.summary.profile?.ruleTimingsMs["todo-comment"] !== undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps parallel detector dispatch equivalent to serial dispatch", async () => {
    const cwd = process.cwd();
    const baseOptions = {
      cwd,
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: [],
      minSeverity: "medium" as const,
      rules: ["duplicate-logic", "prop-drilling"],
      thresholds: {},
      maxFiles: defaultConfig.maxFiles,
    };

    const serial = await scan(baseOptions);
    const parallel = await scan({ ...baseOptions, parallel: true });

    assert.deepEqual(
      parallel.issues.map((issue) => [issue.ruleId, issue.file, issue.location?.startLine]),
      serial.issues.map((issue) => [issue.ruleId, issue.file, issue.location?.startLine]),
    );
    assert.equal(parallel.summary.performance?.parallel, true);
  });

  it("merges async parallel detector warnings in detector order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-parallel-warnings-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");
      const slowDetector = buildWarningDetector("plugin-slow", "slow warning", 20);
      const fastDetector = buildWarningDetector("plugin-fast", "fast warning", 1);

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["plugin-slow", "plugin-fast"],
        thresholds: defaultConfig.thresholds,
        parallel: true,
        pluginDetectors: [slowDetector, fastDetector],
      });

      assert.deepEqual(result.summary.warnings, [
        "plugin-slow: slow warning",
        "plugin-fast: fast warning",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("disables scan caching when plugin detectors are loaded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-plugin-cache-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");
      const cachePath = join(dir, ".debtlens", "cache.json");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["plugin-warning"],
        thresholds: defaultConfig.thresholds,
        cache: true,
        cachePath,
        pluginDetectors: [buildWarningDetector("plugin-warning", "checked", 1)],
      });

      assert.equal(existsSync(cachePath), false);
      assert.equal(result.summary.performance, undefined);
      assert.match(result.summary.warnings?.[0] ?? "", /scan cache disabled when plugin detectors are loaded/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads source files in bounded batches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-batch-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "one.ts"), "// TODO one\nexport const one = 1;\n");
      writeFileSync(join(dir, "src", "two.ts"), "// TODO two\nexport const two = 2;\n");
      writeFileSync(join(dir, "src", "three.ts"), "// TODO three\nexport const three = 3;\n");

      const result = await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["todo-comment"],
        thresholds: defaultConfig.thresholds,
        batchSize: 1,
      });

      assert.equal(result.summary.filesScanned, 3);
      assert.equal(result.summary.totalIssues, 3);
      assert.equal(result.summary.performance?.batchSize, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function buildWarningDetector(id: string, warning: string, delayMs: number): Detector {
  return {
    id,
    name: id,
    description: id,
    defaultSeverity: "low",
    tags: ["test"],
    async detect(context) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      context.addWarning(`${id}: ${warning}`);
      return [];
    },
  };
}
