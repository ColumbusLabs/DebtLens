import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { runFix } from "../../src/cli/fix.js";
import { defaultConfig } from "../../src/config/defaults.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const localRequire = createRequire(import.meta.url);
const tsxLoader = localRequire.resolve("tsx");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliEntrypoint, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("debtlens fix", () => {
  it("dry-runs duplicated-literal extraction without writing files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-fix-dry-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "billing.ts"), `export const one = "payment-overdue";\n`);
      writeFileSync(join(dir, "src", "notifications.ts"), `export const two = "payment-overdue";\n`);
      writeFileSync(join(dir, "src", "reports.ts"), `export const three = "payment-overdue";\n`);

      const result = await runFix({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["duplicated-literal"],
        thresholds: defaultConfig.thresholds,
      }, { dryRun: true });

      assert.ok(result.diffs.length > 0);
      assert.match(result.diffs.join("\n"), /SHARED_PAYMENT_OVERDUE/);
      assert.match(readFileSync(join(dir, "src", "billing.ts"), "utf8"), /"payment-overdue"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inlines a pass-through dead-abstraction wrapper when --fix is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-fix-dead-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "copy.ts"), `
function buildCopy(locale) {
  return locale.toUpperCase();
}
function getCopy(locale) {
  return buildCopy(locale);
}
export const label = getCopy("en");
`);
      const result = await runFix({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["dead-abstraction"],
        thresholds: defaultConfig.thresholds,
      }, { rules: ["dead-abstraction"], dryRun: false });

      assert.ok(result.filesTouched >= 1);
      const updated = readFileSync(join(dir, "src", "copy.ts"), "utf8");
      assert.doesNotMatch(updated, /function getCopy/);
      assert.match(updated, /buildCopy\("en"\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-writable rules in write mode before touching files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-fix-reject-rule-"));
    try {
      mkdirSync(join(dir, "src"));
      const file = join(dir, "src", "billing.ts");
      writeFileSync(file, `export const one = "payment-overdue";\n`);
      await assert.rejects(
        () => runFix({
          cwd: dir,
          target: dir,
          include: defaultConfig.include,
          exclude: defaultConfig.exclude,
          minSeverity: "low",
          rules: ["duplicated-literal"],
          thresholds: defaultConfig.thresholds,
        }, { rules: ["duplicated-literal"], dryRun: false }),
        /not writable/,
      );
      assert.match(readFileSync(file, "utf8"), /"payment-overdue"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not remove exported pass-through wrappers in write mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-fix-exported-"));
    try {
      mkdirSync(join(dir, "src"));
      const file = join(dir, "src", "copy.ts");
      writeFileSync(file, `
export function buildCopy(locale) {
  return locale.toUpperCase();
}
export function getCopy(locale) {
  return buildCopy(locale);
}
export const label = getCopy("en");
`);
      const result = await runFix({
        cwd: dir,
        target: dir,
        include: defaultConfig.include,
        exclude: defaultConfig.exclude,
        minSeverity: "low",
        rules: ["dead-abstraction"],
        thresholds: defaultConfig.thresholds,
      }, { rules: ["dead-abstraction"], dryRun: false });

      assert.equal(result.filesTouched, 0);
      assert.match(readFileSync(file, "utf8"), /export function getCopy/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints dry-run output from the CLI by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-fix-cli-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "billing.ts"), `export const one = "payment-overdue";\n`);
      writeFileSync(join(dir, "src", "notifications.ts"), `export const two = "payment-overdue";\n`);
      writeFileSync(join(dir, "src", "reports.ts"), `export const three = "payment-overdue";\n`);
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({ rules: ["duplicated-literal"] }));

      const result = runCli(["fix", ".", "--config", "debtlens.config.json"], dir);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Dry-run/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
