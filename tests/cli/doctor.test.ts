import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: process.env,
  });
}

function runDoctor(args: string[], options: { cwd?: string } = {}) {
  return runCli(["doctor", ...args], options);
}

describe("debtlens doctor", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "debtlens-doctor-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the config path when present", () => {
    const configPath = join(dir, "debtlens.config.json");
    writeFileSync(configPath, JSON.stringify({ pack: "core", include: ["src/**/*.ts"] }), "utf8");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "keep.ts"), "export const ok = 1;\n");

    const result = runDoctor([".", "--cwd", dir, "--config", configPath]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`Config: ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(result.stdout, /Config schema: valid/);
    assert.match(result.stdout, /Pack: core/);
    assert.match(result.stdout, /duplicate-logic/);
    assert.match(result.stdout, /Matched files: 1/);
  });

  it("warns when an explicit config path is missing", () => {
    const configPath = join(dir, "missing.config.json");

    const result = runDoctor([".", "--cwd", dir, "--config", configPath]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`Config: ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(missing\\)`));
    assert.match(result.stdout, /Config schema: \(not checked\)/);
    assert.match(result.stdout, new RegExp(`DebtLens warning: config file not found at ${configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  });

  it("validates config shape and exits nonzero for schema violations", () => {
    const configPath = join(dir, "debtlens.config.json");
    writeFileSync(configPath, JSON.stringify({
      $schema: 123,
      minSeverity: "urgent",
      rules: ["todo-comment", "todo-comment"],
      thresholds: { "large-component.maxLines": "many" },
      todoComment: { markers: [{ severity: "critical" }] },
      mystery: true,
    }), "utf8");

    const result = runDoctor([".", "--cwd", dir]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Config schema: invalid/);
    assert.match(result.stdout, /\$schema must be a string/);
    assert.match(result.stdout, /rules must not contain duplicate values/);
    assert.match(result.stdout, /unknown property "mystery"/);
    assert.match(result.stdout, /minSeverity must be one of info, low, medium, high/);
    assert.match(result.stdout, /thresholds\.large-component\.maxLines must be a number/);
    assert.match(result.stdout, /todoComment\.markers\[0\]\.pattern must be a string/);
  });

  it("reports plugin config dependency errors in the doctor output", () => {
    writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
      plugins: ["./plugin.mjs"],
    }), "utf8");

    const result = runDoctor([".", "--cwd", dir]);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Config schema: invalid/);
    assert.match(result.stdout, /plugins requires pluginApiVersion/);
    assert.doesNotMatch(result.stderr, /DebtLens failed/);
  });

  it("warns when zero files match the include globs", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "keep.ts"), "export const ok = 1;\n");

    const result = runDoctor([".", "--cwd", dir, "--include", "missing/**/*.ts"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Matched files: 0/);
    assert.match(result.stdout, /Include globs: missing\/\*\*\/\*\.ts/);
    assert.match(result.stdout, /DebtLens warning: scanned 0 files/);
  });

  it("prints exclude globs and applies them to matched files", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "keep.ts"), "export const ok = 1;\n");
    writeFileSync(join(dir, "src", "skip.ts"), "export const skip = 1;\n");

    const result = runDoctor([".", "--cwd", dir, "--include", "src/**/*.ts", "--exclude", "src/skip.ts"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Exclude globs: .*src\/skip\.ts/);
    assert.match(result.stdout, /Matched files: 1/);
  });

  it("notes when --changed is ignored outside a git repo", () => {
    const result = runDoctor([".", "--cwd", dir, "--changed"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Git repository: no/);
    assert.match(result.stdout, /Changed mode: ignored \(not a git repository\)/);
  });

  it("lists core pack rules when --pack core is passed", () => {
    const result = runDoctor([".", "--cwd", dir, "--pack", "core"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Pack: core/);
    assert.match(result.stdout, /Rules: duplicate-logic, dead-abstraction, todo-comment, naming-drift/);
  });
});
