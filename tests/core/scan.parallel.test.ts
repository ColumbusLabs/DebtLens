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

    assert.equal(JSON.stringify(parallel.issues), JSON.stringify(serial.issues));
    assert.equal(parallel.summary.performance?.parallel, true);
  });

  it("keeps --concurrency 1 on the serial execution path", async () => {
    const cwd = process.cwd();
    const result = await scan({
      cwd,
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: [],
      minSeverity: "medium",
      rules: ["duplicate-logic", "duplicated-literal", "import-cycle"],
      thresholds: {},
      maxFiles: defaultConfig.maxFiles,
      concurrency: 1,
    });

    assert.equal(result.summary.performance?.parallel, undefined);
    assert.equal(result.summary.performance, undefined);
  });

  it("keeps concurrency-based dispatch equivalent to serial dispatch", async () => {
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
    const parallel = await scan({ ...baseOptions, concurrency: 2 });

    assert.deepEqual(
      parallel.issues.map((issue) => [issue.ruleId, issue.file, issue.location?.startLine]),
      serial.issues.map((issue) => [issue.ruleId, issue.file, issue.location?.startLine]),
    );
    assert.equal(parallel.summary.performance?.parallel, true);
  });

  it("runs cross-file aggregation once with complete repository context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cross-file-parallel-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), `import "./b";\nexport const a = "shared-domain-literal";\n`);
      writeFileSync(join(dir, "src", "b.ts"), `import "./a";\nexport const b = "shared-domain-literal";\n`);
      writeFileSync(join(dir, "src", "c.ts"), `export const c = "shared-domain-literal";\n`);
      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["duplicated-literal", "import-cycle"],
        thresholds: defaultConfig.thresholds,
      };

      const serial = await scan({ ...baseOptions, concurrency: 1 });
      const parallel = await scan({ ...baseOptions, concurrency: 3 });

      assert.ok(serial.issues.some((issue) => issue.ruleId === "duplicated-literal"));
      assert.ok(serial.issues.some((issue) => issue.ruleId === "import-cycle"));
      assert.equal(JSON.stringify(parallel.issues), JSON.stringify(serial.issues));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps cross-file feature flag references byte-identical in parallel scans", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-feature-flag-parallel-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "flags.ts"), "export const enableCheckout = true;\n");
      writeFileSync(
        join(dir, "src", "app.ts"),
        'import { enableCheckout } from "./flags";\nexport const route = enableCheckout ? "/new" : "/old";\n',
      );
      const baseOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low" as const,
        rules: ["stale-feature-flag"],
        thresholds: defaultConfig.thresholds,
        featureFlags: {
          registryGlobs: ["src/flags.ts"],
          accessPatterns: [],
          constantNamePatterns: [],
        },
      };

      const serial = await scan({ ...baseOptions, concurrency: 1 });
      const parallel = await scan({ ...baseOptions, concurrency: 2 });

      assert.equal(serial.issues.length, 1);
      assert.match(serial.issues[0]?.message ?? "", /hardcoded to true/);
      assert.doesNotMatch(serial.issues[0]?.message ?? "", /never referenced/);
      assert.equal(JSON.stringify(parallel.issues), JSON.stringify(serial.issues));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps concurrent detector dispatch when concurrency is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-concurrency-cap-"));
    let active = 0;
    let maxActive = 0;
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "export const value = 1;\n");
      const detectors: Detector[] = [1, 2, 3, 4].map((index) => ({
        id: `plugin-cap-${index}`,
        name: `plugin-cap-${index}`,
        description: "test",
        defaultSeverity: "low",
        tags: ["test"],
        async detect() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return [];
        },
      }));

      await scan({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: detectors.map((detector) => detector.id),
        thresholds: defaultConfig.thresholds,
        concurrency: 2,
        pluginDetectors: detectors,
      });

      assert.equal(maxActive, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
