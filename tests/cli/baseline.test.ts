import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const require = createRequire(import.meta.url);
const tsxImport = require.resolve("tsx");

function runCli(args: string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, ["--import", tsxImport, cliEntrypoint, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });
}

function runBaseline(args: string[], options: { cwd?: string } = {}) {
  return runCli(["baseline", ...args], options);
}

function runScan(args: string[], options: { cwd?: string } = {}) {
  return runCli(["scan", ...args], options);
}

function withFixture(test: (dir: string, baselinePath: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-baseline-"));
  try {
    const baselinePath = join(dir, "debtlens-baseline.json");
    test(dir, baselinePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSource(dir: string, name: string, content: string) {
  writeFileSync(join(dir, name), content, "utf8");
}

describe("debtlens baseline", () => {
  it("diff previews resolved baseline entries without modifying the file", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: fix this later\nexport const a = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);
    const before = readFileSync(baselinePath, "utf8");

    writeSource(dir, "a.ts", "export const a = 1;\n");
    const diff = runBaseline(["diff", ".", "--baseline", baselinePath, "--format", "json"], { cwd: dir });
    assert.equal(diff.status, 0, diff.stderr);
    const parsed = JSON.parse(diff.stdout);

    assert.equal(parsed.wroteBaseline, false);
    assert.equal(parsed.delta.resolved, 1);
    assert.equal(parsed.resolvedFingerprints.length, 1);
    assert.equal(readFileSync(baselinePath, "utf8"), before);
  }));

  it("prune removes only resolved fingerprints and preserves top-level metadata", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: first\nexport const a = 1;\n");
    writeSource(dir, "b.ts", "// TODO: second\nexport const b = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    baseline.$schema = "https://example.com/debtlens-baseline.schema.json";
    baseline.comment = "owned by platform";
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

    writeSource(dir, "a.ts", "export const a = 1;\n");
    const prune = runBaseline(["prune", ".", "--baseline", baselinePath, "--format", "json"], { cwd: dir });
    assert.equal(prune.status, 0, prune.stderr);
    const parsed = JSON.parse(prune.stdout);
    const pruned = JSON.parse(readFileSync(baselinePath, "utf8"));

    assert.equal(parsed.wroteBaseline, true);
    assert.equal(parsed.delta.resolved, 1);
    assert.equal(Object.keys(pruned.fingerprints).length, 1);
    assert.equal(pruned.$schema, "https://example.com/debtlens-baseline.schema.json");
    assert.equal(pruned.comment, "owned by platform");
  }));

  it("update dry-run previews the rewrite and update writes the current scan", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: original\nexport const a = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);
    const before = readFileSync(baselinePath, "utf8");

    writeSource(dir, "b.ts", "// TODO: new\nexport const b = 1;\n");
    const dryRun = runBaseline(["update", ".", "--baseline", baselinePath, "--dry-run", "--format", "json"], { cwd: dir });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).wroteBaseline, false);
    assert.equal(readFileSync(baselinePath, "utf8"), before);

    const update = runBaseline(["update", ".", "--baseline", baselinePath, "--format", "json"], { cwd: dir });
    assert.equal(update.status, 0, update.stderr);
    assert.equal(JSON.parse(update.stdout).wroteBaseline, true);
    const updated = JSON.parse(readFileSync(baselinePath, "utf8"));
    assert.equal(Object.keys(updated.fingerprints).length, 2);
  }));

  it("prunes legacy baselines that lack summary and issue metadata", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: legacy\nexport const a = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    delete baseline.summary;
    delete baseline.issues;
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

    writeSource(dir, "a.ts", "export const a = 1;\n");
    const prune = runBaseline(["prune", ".", "--baseline", baselinePath, "--format", "json"], { cwd: dir });
    assert.equal(prune.status, 0, prune.stderr);
    const pruned = JSON.parse(readFileSync(baselinePath, "utf8"));

    assert.equal(JSON.parse(prune.stdout).delta.hasBaselineSummary, false);
    assert.deepEqual(pruned.fingerprints, {});
    assert.equal("summary" in pruned, false);
    assert.equal("issues" in pruned, false);
  }));

  it("fails clearly when the baseline file is missing", () => withFixture((dir, baselinePath) => {
    assert.equal(existsSync(baselinePath), false);
    const result = runBaseline(["diff", ".", "--baseline", baselinePath], { cwd: dir });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Baseline file not found/);
  }));

  it("refuses mutating prune with scoped scan flags but allows dry-run preview", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: scoped\nexport const a = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);

    writeSource(dir, "a.ts", "export const a = 1;\n");
    const scoped = runBaseline(["prune", ".", "--rules", "todo-comment", "--baseline", baselinePath], { cwd: dir });
    assert.equal(scoped.status, 1);
    assert.match(scoped.stderr, /baseline prune refuses scoped scans/);
    assert.notDeepEqual(JSON.parse(readFileSync(baselinePath, "utf8")).fingerprints, {});

    const preview = runBaseline(["prune", ".", "--rules", "todo-comment", "--baseline", baselinePath, "--dry-run", "--format", "json"], { cwd: dir });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(JSON.parse(preview.stdout).wroteBaseline, false);
  }));

  it("refuses mutating prune with a narrowed minimum severity", () => withFixture((dir, baselinePath) => {
    writeSource(dir, "a.ts", "// TODO: keep this low-severity finding\nexport const a = 1;\n");
    const write = runScan([".", "--write-baseline", baselinePath], { cwd: dir });
    assert.equal(write.status, 0, write.stderr);
    const before = readFileSync(baselinePath, "utf8");

    const prune = runBaseline(["prune", ".", "--min-severity", "medium", "--baseline", baselinePath], { cwd: dir });
    assert.equal(prune.status, 1);
    assert.match(prune.stderr, /baseline prune refuses scoped scans/);
    assert.equal(readFileSync(baselinePath, "utf8"), before);
  }));
});
