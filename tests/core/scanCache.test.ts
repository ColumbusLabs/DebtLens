import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { buildScanCacheKey, getScanCachePath, readCachedScan, writeCachedScan } from "../../src/core/scanCache.js";
import { toCacheKeyPayload } from "../../src/core/types.js";
import type { Detector, ScanOptions, ScanResult } from "../../src/core/types.js";
import { packageVersion } from "../../src/utils/packageInfo.js";

const stubDetector: Detector = {
  id: "todo-comment",
  name: "Todo comment",
  description: "test",
  defaultSeverity: "low",
  tags: ["test"],
  detect: () => [],
};

function buildScanResult(): ScanResult {
  return {
    schemaVersion: 1,
    issues: [],
    summary: {
      totalIssues: 0,
      bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
      byRule: {},
      filesScanned: 0,
      rulesRun: 0,
      elapsedMs: 0,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "low" },
  };
}

describe("scan cache", () => {
  it("builds stable keys from toCacheKeyPayload", () => {
    const options: ScanOptions = {
      cwd: "/tmp/project",
      target: "/tmp/project/src",
      include: defaultConfig.include,
      exclude: defaultConfig.exclude,
      minSeverity: "low",
      rules: ["todo-comment"],
      thresholds: defaultConfig.thresholds,
    };

    const payload = toCacheKeyPayload(1, packageVersion, options, [stubDetector]);
    const key = buildScanCacheKey(options, [stubDetector]);

    assert.deepEqual(payload.detectorIds, ["todo-comment"]);
    assert.equal(payload.packageVersion, packageVersion);
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(buildScanCacheKey(options, [stubDetector]), key);
    assert.notEqual(
      buildScanCacheKey({
        ...options,
        featureFlags: { accessPatterns: [{ callee: "customFlags.enabled", keyArgument: 1 }] },
      }, [stubDetector]),
      key,
    );
  });

  it("keeps keys portable across checkout roots and invalidates config or scanner versions", () => {
    const makeOptions = (root: string): ScanOptions => ({
      cwd: root,
      target: join(root, "packages", "app"),
      include: defaultConfig.include,
      exclude: defaultConfig.exclude,
      minSeverity: "low",
      rules: ["todo-comment"],
      thresholds: defaultConfig.thresholds,
      changedFiles: [join(root, "packages", "app", "src", "index.ts")],
    });
    const first = makeOptions("/runner/one/checkout");
    const restored = makeOptions("/different/root/checkout");

    assert.equal(buildScanCacheKey(first, [stubDetector]), buildScanCacheKey(restored, [stubDetector]));
    assert.notEqual(
      buildScanCacheKey(first, [stubDetector]),
      buildScanCacheKey({ ...first, thresholds: { ...first.thresholds, "todo-comment.limit": 2 } }, [stubDetector]),
    );
    assert.notEqual(
      buildScanCacheKey(first, [stubDetector], [], "0.4.0"),
      buildScanCacheKey(first, [stubDetector], [], "0.5.0"),
    );
    const source = join(first.target, "src", "index.ts");
    assert.notEqual(
      buildScanCacheKey(first, [stubDetector], [{ absolutePath: source, cacheIdentity: "src/index.ts", content: "one", hash: "one" }]),
      buildScanCacheKey(first, [stubDetector], [{ absolutePath: source, cacheIdentity: "src/index.ts", content: "two", hash: "two" }]),
    );
  });

  it("writes cache files atomically without leaving temp files behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-scan-cache-"));
    try {
      const options: ScanOptions = {
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        thresholds: defaultConfig.thresholds,
        cachePath: ".debtlens/cache.json",
      };
      const cachePath = getScanCachePath(options);
      const key = buildScanCacheKey(options, [stubDetector]);
      const files = [{ absolutePath: join(dir, "src", "app.ts"), content: "export const app = 1;\n", hash: "abc" }];
      const result = buildScanResult();

      writeCachedScan(cachePath, key, files, result);

      assert.equal(existsSync(cachePath), true);
      const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as { entries: Array<{ key: string }> };
      assert.equal(parsed.entries[0]?.key, key);
      assert.equal(readdirSync(join(dir, ".debtlens")).every((name) => !name.endsWith(".tmp")), true);

      const cached = readCachedScan(cachePath, key, files);
      assert.deepEqual(cached?.summary, result.summary);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
