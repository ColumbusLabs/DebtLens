import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const exampleDir = join(repoRoot, "examples", "plugin");

function runScan(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("examples/plugin reference plugin", () => {
  it("loads the no-console plugin and reports its finding", () => {
    const result = runScan([".", "--cwd", exampleDir, "--rules", "no-console", "--format", "json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.equal(parsed.issues[0].ruleId, "no-console");
    assert.equal(parsed.issues[0].file, "src/app.ts");
    assert.equal(parsed.issues[0].location.startLine, 2);
  });

  it("respects DEBTLENS_DISABLE_PLUGINS for the example config", () => {
    const result = runScan([".", "--cwd", exampleDir, "--format", "json"], {
      DEBTLENS_DISABLE_PLUGINS: "1",
    });
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.ok(!parsed.issues.some((issue: { ruleId: string }) => issue.ruleId === "no-console"));
  });
});
