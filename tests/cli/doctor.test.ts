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
    assert.match(result.stdout, /Pack: core/);
    assert.match(result.stdout, /duplicate-logic/);
    assert.match(result.stdout, /Matched files: 1/);
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
