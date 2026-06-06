import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CONFIG_FILENAME, runInit } from "../../src/cli/init.js";

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
    assert.equal(parsed.rules.length, 8);
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

  it("rejects unknown pack ids", () => {
    assert.throws(() => runInit(dir, false, "vue"), /Unknown rule pack "vue"/);
  });
});
