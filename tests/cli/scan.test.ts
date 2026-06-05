import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runScan(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("debtlens scan warnings", () => {
  it("warns when include filters resolve zero files", () => {
    const result = runScan(["examples/react", "--include", "**/*.py", "--format", "json"]);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /DebtLens warning: scanned 0 files\./);
    assert.match(result.stderr, /Likely causes: .*include\/exclude globs/);
  });

  it("does not warn for a normal scan that reads files", () => {
    const result = runScan(["examples/react", "--format", "json"]);

    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /DebtLens warning: scanned 0 files\./);
  });
});
