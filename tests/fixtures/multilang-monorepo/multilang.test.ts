import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)));
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runScan(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("multi-language monorepo scan", () => {
  it("scans TypeScript and Python paths in one command when both packs are enabled", () => {
    const result = runScan([
      ".",
      "--cwd",
      fixtureRoot,
      "--pack",
      "core,python",
      "--rules",
      "todo-comment,python-todo-comment",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);
    const files = parsed.issues.map((issue: { file: string }) => issue.file).sort();

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.filesScanned, 2);
    assert.equal(parsed.summary.totalIssues, 2);
    assert.deepEqual(files, ["backend/service.py", "src/app.ts"]);
  });
});
