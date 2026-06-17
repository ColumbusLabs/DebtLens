import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONFIG_FILENAME, runInit } from "../../src/cli/init.js";
import { suggestConfigFromEslint } from "../../src/cli/eslintMigration.js";
import { configTemplate } from "../../src/config/template.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

describe("debtlens init", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "debtlens-init-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a valid config file", () => {
    const result = runInit(dir);
    assert.equal(result.overwritten, false);
    assert.ok(result.path.endsWith(CONFIG_FILENAME));

    const parsed = JSON.parse(readFileSync(result.path, "utf8"));
    assert.equal(parsed.minSeverity, "low");
    assert.ok(Array.isArray(parsed.rules));
    const templateRules = configTemplate.rules ?? [];
    assert.equal(parsed.rules.length, templateRules.length);
    assert.deepEqual(parsed.rules, templateRules);
    assert.ok(parsed.rules.includes("api-surface-sprawl"));
    assert.ok(parsed.rules.includes("server-client-boundary"));
    assert.ok(parsed.rules.includes("route-sprawl"));
  });

  it("refuses to overwrite an existing config without force", () => {
    runInit(dir);
    assert.throws(() => runInit(dir), /already exists/);
  });

  it("overwrites an existing config when force is set", () => {
    const path = join(dir, CONFIG_FILENAME);
    writeFileSync(path, "{ \"stale\": true }", "utf8");

    const result = runInit(dir, true);
    assert.equal(result.overwritten, true);

    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.stale, undefined);
    assert.equal(parsed.minSeverity, "low");
  });

  it("writes a pack preset when --pack is provided", () => {
    const result = runInit(dir, false, "core");
    assert.equal(result.overwritten, false);

    const parsed = JSON.parse(readFileSync(result.path, "utf8"));
    assert.equal(parsed.pack, "core");
    assert.equal(parsed.rules, undefined);
  });

  it("writes pack threshold presets when --pack is provided", () => {
    const result = runInit(dir, false, "oss-maintainer");
    const parsed = JSON.parse(readFileSync(result.path, "utf8"));

    assert.equal(parsed.pack, "oss-maintainer");
    assert.equal(parsed.thresholds["api-surface-sprawl.maxExports"], 10);
    assert.equal(parsed.thresholds["weak-test-boundary.allowTypeOnly"], 1);
  });

  it("rejects unknown pack ids", () => {
    assert.throws(() => runInit(dir, false, "vue"), /Unknown rule pack "vue"/);
  });

  it("prints a suggested config from ESLint JSON without writing", () => {
    writeFileSync(join(dir, "eslint.config.json"), JSON.stringify([
      {
        rules: {
          "react-hooks/exhaustive-deps": "warn",
          complexity: ["warn", 9],
          "max-depth": ["error", 3],
          "max-lines-per-function": ["warn", { max: 80 }],
        },
      },
    ]));

    const suggested = JSON.parse(suggestConfigFromEslint(dir, "eslint.config.json"));

    assert.equal(suggested.pack, "react");
    assert.equal(suggested.thresholds["complex-control-flow.maxComplexity"], 9);
    assert.equal(suggested.thresholds["complex-control-flow.maxDepth"], 3);
    assert.equal(suggested.thresholds["large-function.maxLines"], 80);
    assert.equal(suggested.rules, undefined);
    assert.equal(readFileSync(join(dir, "eslint.config.json"), "utf8").includes("react-hooks"), true);
    assert.equal(existsSync(join(dir, CONFIG_FILENAME)), false);
  });

  it("wires --from-eslint through the init command", () => {
    writeFileSync(join(dir, ".eslintrc.json"), JSON.stringify({
      rules: {
        complexity: ["warn", 7],
      },
    }));

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      cliEntrypoint,
      "init",
      "--cwd",
      dir,
      "--from-eslint",
      ".eslintrc.json",
    ], { encoding: "utf8" });
    const suggested = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(suggested.thresholds["complex-control-flow.maxComplexity"], 7);
    assert.equal(existsSync(join(dir, CONFIG_FILENAME)), false);
  });
});
