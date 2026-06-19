import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";
import type { Detector } from "../../src/core/types.js";

describe("scan cache", () => {
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

  it("keeps suppression audit cache entries separate from normal scans", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-cache-suppressions-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(
        join(dir, "src", "app.ts"),
        "// debtlens-disable-next-line todo-comment -- tracked in PROJ-1\n// TODO first pass\n",
      );
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

      const withoutAudit = await scan(options);
      const withAudit = await scan({ ...options, auditSuppressions: true });
      const withAuditAgain = await scan({ ...options, auditSuppressions: true });

      assert.equal(withoutAudit.summary.performance?.cache?.hit, false);
      assert.equal(withoutAudit.suppressionDirectives, undefined);
      assert.equal(withAudit.summary.performance?.cache?.hit, false);
      assert.equal(withAudit.suppressionDirectives?.[0]?.status, "used");
      assert.equal(withAuditAgain.summary.performance?.cache?.hit, true);
      assert.equal(withAuditAgain.suppressionDirectives?.[0]?.status, "used");
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
