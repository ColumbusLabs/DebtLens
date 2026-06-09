import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CONFIG_FILENAME } from "../../src/cli/init.js";
import { DEFAULT_BASELINE_FILENAME } from "../../src/core/baseline.js";
import { recommendMinSeverity } from "../../src/cli/adopt.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runAdopt(args: string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "adopt", ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: process.env,
  });
}

describe("recommendMinSeverity", () => {
  it("suggests medium when low-severity noise dominates", () => {
    const recommendation = recommendMinSeverity(
      { info: 2, low: 12, medium: 3, high: 1 },
      18,
    );
    assert.equal(recommendation, "medium");
  });

  it("keeps low when issue volume is small", () => {
    const recommendation = recommendMinSeverity(
      { info: 1, low: 2, medium: 0, high: 0 },
      3,
    );
    assert.equal(recommendation, "low");
  });
});

describe("debtlens adopt", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "debtlens-adopt-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "// TODO: adoption test marker\nexport const ok = 1;\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints an adoption report in dry-run mode by default", () => {
    const result = runAdopt([".", "--cwd", dir, "--rules", "todo-comment"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /DebtLens Adoption Report/);
    assert.match(result.stdout, /Total issues: 1/);
    assert.match(result.stdout, /todo-comment: 1/);
    assert.match(result.stdout, /Dry run — no files written/);
    assert.equal(existsSync(join(dir, CONFIG_FILENAME)), false);
    assert.equal(existsSync(join(dir, DEFAULT_BASELINE_FILENAME)), false);
  });

  it("writes config and baseline when requested", () => {
    const result = runAdopt([
      ".",
      "--cwd",
      dir,
      "--rules",
      "todo-comment",
      "--write-config",
      "--write-baseline",
      "--force",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Created .*debtlens\.config\.json/);
    assert.match(result.stdout, /Wrote baseline with 1 issues/);
    assert.equal(existsSync(join(dir, CONFIG_FILENAME)), true);
    assert.equal(existsSync(join(dir, DEFAULT_BASELINE_FILENAME)), true);

    const baseline = JSON.parse(readFileSync(join(dir, DEFAULT_BASELINE_FILENAME), "utf8"));
    assert.ok(Object.keys(baseline.fingerprints).length >= 1);
  });

  it("skips baseline write when no issues are found", () => {
    writeFileSync(join(dir, "src", "app.ts"), "export const ok = 1;\n");

    const result = runAdopt([
      ".",
      "--cwd",
      dir,
      "--rules",
      "todo-comment",
      "--write-baseline",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Skipped baseline write \(0 issues found\)/);
    assert.equal(existsSync(join(dir, DEFAULT_BASELINE_FILENAME)), false);
  });

  it("refuses to overwrite config without --force", () => {
    writeFileSync(join(dir, CONFIG_FILENAME), "{}\n", "utf8");

    const result = runAdopt([
      ".",
      "--cwd",
      dir,
      "--rules",
      "todo-comment",
      "--write-config",
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
  });
});
