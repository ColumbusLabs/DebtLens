import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { listWorkspacePackages, resolveWorkspacePackage } from "../../../src/config/workspaces.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)));
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runScan(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("workspace package resolution", () => {
  it("lists workspace packages from a fixture monorepo", () => {
    const packages = listWorkspacePackages(fixtureRoot);
    assert.deepEqual(packages.map((pkg) => pkg.name), ["pkg-a", "pkg-b"]);
  });

  it("resolves a package directory by name", () => {
    const resolved = resolveWorkspacePackage(fixtureRoot, "pkg-a");
    assert.match(resolved.directory, /packages\/pkg-a$/);
  });
});

describe("monorepo scan --package", () => {
  it("scans only the selected workspace package", () => {
    const result = runScan([
      ".",
      "--cwd",
      fixtureRoot,
      "--package",
      "pkg-a",
      "--rules",
      "todo-comment",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.match(parsed.issues[0].file, /^src\/index\.ts$/);
  });

  it("scans all workspace packages when --package is omitted", () => {
    const result = runScan([
      ".",
      "--cwd",
      fixtureRoot,
      "--rules",
      "todo-comment",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.match(parsed.issues[0].file, /pkg-a/);
  });
});
