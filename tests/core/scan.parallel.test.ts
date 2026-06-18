import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";
import type { Detector } from "../../src/core/types.js";

describe("scan parallel dispatch", () => {
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
