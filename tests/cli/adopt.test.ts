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
import { buildThresholdSuggestions } from "../../src/cli/adoptionThresholds.js";
import type { ScanOptions, ScanResult } from "../../src/core/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const monorepoFixtureRoot = join(repoRoot, "tests", "fixtures", "monorepo");

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

describe("buildThresholdSuggestions", () => {
  it("suggests higher rollout thresholds from observed findings", () => {
    const result: ScanResult = {
      schemaVersion: 1,
      issues: [{
        id: "large",
        fingerprint: "large",
        ruleId: "large-component",
        ruleName: "Large component",
        severity: "medium",
        confidence: 0.8,
        message: "App appears to own too many responsibilities.",
        file: "src/App.tsx",
        evidence: ["Lines: 400 / 250", "Hook calls: 14 / 10", "Branch points: 20 / 16"],
        tags: [],
      }],
      summary: {
        totalIssues: 1,
        bySeverity: { info: 0, low: 0, medium: 1, high: 0 },
        byRule: { "large-component": 1 },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: [], exclude: [], minSeverity: "low", rules: ["large-component"] },
    };
    const options = {
      cwd: repoRoot,
      target: repoRoot,
      include: [],
      exclude: [],
      minSeverity: "low" as const,
      thresholds: {
        "large-component.maxLines": 250,
        "large-component.maxHooks": 10,
        "large-component.maxBranches": 16,
      },
    } satisfies ScanOptions;

    const suggestions = buildThresholdSuggestions(result, options);

    assert.deepEqual(suggestions.map((suggestion) => suggestion.key), [
      "large-component.maxBranches",
      "large-component.maxHooks",
      "large-component.maxLines",
    ]);
    assert.equal(suggestions.find((suggestion) => suggestion.key === "large-component.maxLines")?.suggested, 441);
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
    assert.match(result.stdout, /Rollout plan:/);
    assert.match(result.stdout, /1\. Start with a focused dry run/);
    assert.match(result.stdout, /Recommended first pack: core/);
    assert.match(result.stdout, /debtlens scan .*--write-baseline debtlens-baseline\.json/);
    assert.match(result.stdout, /debtlens scan .*--baseline debtlens-baseline\.json .*--fail-on high/);
    assert.match(result.stdout, /debtlens scan .*--changed origin\/main/);
    assert.match(result.stdout, /debtlens scan .*--staged .*--fail-on-confidence 0\.8/);
    assert.match(result.stdout, /Dry run — no files written/);
    assert.equal(existsSync(join(dir, CONFIG_FILENAME)), false);
    assert.equal(existsSync(join(dir, DEFAULT_BASELINE_FILENAME)), false);
  });

  it("prints a stakeholder severity histogram as markdown", () => {
    const result = runAdopt([".", "--cwd", dir, "--rules", "todo-comment", "--format", "markdown"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^# DebtLens Adoption Report/m);
    assert.match(result.stdout, /\| Severity \| Issues \|/);
    assert.match(result.stdout, /\| `todo-comment` \| 1 \|/);
    assert.match(result.stdout, /^## Rollout Plan/m);
    assert.match(result.stdout, /1\. \*\*Start with a focused dry run\*\*/);
    assert.match(result.stdout, /Command: `debtlens adopt .*--format markdown`/);
    assert.match(result.stdout, /Rationale: .*Recommended first pack: core/);
  });

  it("prints threshold suggestions when adoption findings exceed defaults", () => {
    const result = runAdopt(["examples/react", "--rules", "large-component", "--threshold", "large-component.maxLines=20"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Suggested threshold tuning:/);
    assert.match(result.stdout, /large-component\.maxLines/);
  });

  it("supports package-scoped adoption reports in workspaces", () => {
    const pkgA = runAdopt([".", "--cwd", monorepoFixtureRoot, "--package", "pkg-a", "--rules", "todo-comment"]);
    const pkgB = runAdopt([".", "--cwd", monorepoFixtureRoot, "--package", "pkg-b", "--rules", "todo-comment"]);

    assert.equal(pkgA.status, 0);
    assert.match(pkgA.stdout, /Total issues: 1/);
    assert.match(pkgA.stdout, /Start with a package-scoped dry run/);
    assert.match(pkgA.stdout, /--package pkg-a/);
    assert.equal(pkgB.status, 0);
    assert.match(pkgB.stdout, /Total issues: 0/);
    assert.match(pkgB.stdout, /Skip the baseline unless legacy debt appears/);
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

  it("persists suggested threshold tuning when writing config", () => {
    const result = runAdopt([
      join(repoRoot, "examples", "react"),
      "--rules",
      "large-component",
      "--threshold",
      "large-component.maxLines=20",
      "--write-config",
      "--force",
      "--cwd",
      dir,
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Suggested threshold tuning:/);
    const config = JSON.parse(readFileSync(join(dir, CONFIG_FILENAME), "utf8"));
    assert.ok(config.thresholds["large-component.maxLines"] > 20);
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
