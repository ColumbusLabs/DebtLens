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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    assert.match(result.stdout, /Rules: duplicate-logic, test-duplication, large-function, complex-control-flow, import-cycle, config-drift, dead-abstraction, duplicated-literal, todo-comment, naming-drift, barrel-file, weak-test-boundary, api-surface-sprawl/);
  });

  it("prints provenance for defaults, config, pack defaults, and CLI threshold overrides", () => {
    const configPath = join(dir, "debtlens.config.json");
    writeFileSync(configPath, JSON.stringify({
      pack: "core",
      include: ["src/**/*.ts"],
      exclude: ["src/generated.ts"],
      thresholds: {
        "large-component.maxLines": 42,
        "shared.max": 2,
      },
      vocabulary: {
        commerce: ["movie", "title"],
      },
    }), "utf8");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "keep.ts"), "export const ok = 1;\n");

    const result = runDoctor([
      ".",
      "--cwd",
      dir,
      "--provenance",
      "--pack",
      "next",
      "--threshold",
      "large-component.maxLines=333,cli.only=9",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Provenance\n----------/);
    assert.match(result.stdout, /Pack: CLI --pack/);
    assert.match(result.stdout, new RegExp(`Include globs: root config \\(${escapeRegex(configPath)}\\)`));
    assert.match(result.stdout, /Exclude globs: defaults \+ root config/);
    assert.match(result.stdout, /api-surface-sprawl\.maxExports: pack "next" defaults/);
    assert.match(result.stdout, /large-function\.maxLines: defaults/);
    assert.match(result.stdout, /large-component\.maxLines: CLI --threshold/);
    assert.match(result.stdout, /cli\.only: CLI --threshold/);
    assert.match(result.stdout, new RegExp(`shared\\.max: root config \\(${escapeRegex(configPath)}\\)`));
    assert.match(result.stdout, new RegExp(`commerce: root config \\(${escapeRegex(configPath)}\\)`));
    assert.match(result.stdout, /Min severity: defaults/);
  });

  it("uses config minSeverity when the CLI flag is omitted", () => {
    const configPath = join(dir, "debtlens.config.json");
    writeFileSync(configPath, JSON.stringify({
      minSeverity: "high",
    }), "utf8");

    const result = runDoctor([".", "--cwd", dir, "--provenance"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Min severity: high/);
    assert.match(result.stdout, new RegExp(`Min severity: root config \\(${escapeRegex(configPath)}\\)`));
  });

  it("shows package-level config provenance for workspace doctor runs", () => {
    mkdirSync(join(dir, "packages", "pkg-a", "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "fixture-root",
      private: true,
      workspaces: ["packages/*"],
    }), "utf8");
    writeFileSync(join(dir, "packages", "pkg-a", "package.json"), JSON.stringify({
      name: "pkg-a",
      private: true,
    }), "utf8");
    const rootConfigPath = join(dir, "debtlens.config.json");
    const packageConfigPath = join(dir, "packages", "pkg-a", "debtlens.config.json");
    writeFileSync(rootConfigPath, JSON.stringify({
      include: ["src/**/*.ts"],
      thresholds: {
        "root.only": 1,
        "shared.max": 1,
      },
    }), "utf8");
    writeFileSync(packageConfigPath, JSON.stringify({
      include: ["pkg-src/**/*.ts"],
      thresholds: {
        "package.only": 2,
        "shared.max": 2,
      },
    }), "utf8");
    writeFileSync(join(dir, "packages", "pkg-a", "src", "keep.ts"), "export const ok = 1;\n");

    const result = runDoctor([".", "--cwd", dir, "--package", "pkg-a", "--provenance"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`Config sources:\\n  root config: ${escapeRegex(rootConfigPath)}\\n  package config: ${escapeRegex(packageConfigPath)}`));
    assert.match(result.stdout, new RegExp(`Include globs: root config \\(${escapeRegex(rootConfigPath)}\\) \\+ package config \\(${escapeRegex(packageConfigPath)}\\)`));
    assert.match(result.stdout, new RegExp(`root\\.only: root config \\(${escapeRegex(rootConfigPath)}\\)`));
    assert.match(result.stdout, new RegExp(`package\\.only: package config \\(${escapeRegex(packageConfigPath)}\\)`));
    assert.match(result.stdout, new RegExp(`shared\\.max: package config \\(${escapeRegex(packageConfigPath)}\\)`));
  });

  it("shows plugin threshold and vocabulary defaults in provenance mode", () => {
    writeFileSync(join(dir, "plugin.mjs"), `
export default {
  rules: [],
  thresholds: { "plugin.max": 7 },
  vocabulary: { "plugin-domain": ["alpha", "beta"] }
};
`, "utf8");
    const configPath = join(dir, "debtlens.config.json");
    writeFileSync(configPath, JSON.stringify({
      pluginApiVersion: 1,
      plugins: ["./plugin.mjs"],
    }), "utf8");

    const plainResult = runDoctor([".", "--cwd", dir]);
    const result = runDoctor([".", "--cwd", dir, "--provenance"]);

    assert.equal(plainResult.status, 0);
    assert.match(plainResult.stdout, /plugin\.max=7/);
    assert.doesNotMatch(plainResult.stdout, /Provenance/);
    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`Plugins: root config \\(${escapeRegex(configPath)}\\)`));
    assert.match(result.stdout, /plugin\.max: plugin defaults/);
    assert.match(result.stdout, /plugin-domain: plugin defaults/);
  });

  it("shows package plugin provenance when package config overrides root plugins", () => {
    mkdirSync(join(dir, "packages", "pkg-a", "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "fixture-root",
      private: true,
      workspaces: ["packages/*"],
    }), "utf8");
    writeFileSync(join(dir, "packages", "pkg-a", "package.json"), JSON.stringify({
      name: "pkg-a",
      private: true,
    }), "utf8");
    writeFileSync(join(dir, "root-plugin.mjs"), `
export default {
  rules: [],
  thresholds: { "root.plugin": 1 }
};
`, "utf8");
    writeFileSync(join(dir, "packages", "pkg-a", "package-plugin.mjs"), `
export default {
  rules: [],
  thresholds: { "package.plugin": 2 }
};
`, "utf8");
    writeFileSync(join(dir, "packages", "pkg-a", "src", "keep.ts"), "export const ok = 1;\n");
    const rootConfigPath = join(dir, "debtlens.config.json");
    const packageConfigPath = join(dir, "packages", "pkg-a", "debtlens.config.json");
    writeFileSync(rootConfigPath, JSON.stringify({
      pluginApiVersion: 1,
      plugins: ["./root-plugin.mjs"],
    }), "utf8");
    writeFileSync(packageConfigPath, JSON.stringify({
      pluginApiVersion: 1,
      plugins: ["./package-plugin.mjs"],
    }), "utf8");

    const result = runDoctor([".", "--cwd", dir, "--package", "pkg-a", "--provenance"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, new RegExp(`Plugins: package config \\(${escapeRegex(packageConfigPath)}\\)`));
    assert.match(result.stdout, /package\.plugin: plugin defaults/);
    assert.doesNotMatch(result.stdout, /root\.plugin/);
    assert.doesNotMatch(result.stdout, new RegExp(`Plugins: root config \\(${escapeRegex(rootConfigPath)}\\) \\+ package config`));
  });
});
