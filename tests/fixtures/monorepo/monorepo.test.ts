import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { listWorkspacePackages, resolveWorkspacePackage } from "../../../src/config/workspaces.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)));
const nestedFixtureRoot = join(repoRoot, "tests", "fixtures", "monorepo-nested");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runScan(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "scan", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runDoctor(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "doctor", ...args], {
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

  it("discovers pnpm and Nx packages in nested app/lib layouts", () => {
    const packages = listWorkspacePackages(nestedFixtureRoot);

    assert.deepEqual(packages.map((pkg) => pkg.name), ["api-service", "ui-lib", "web-app"]);
    assert.match(resolveWorkspacePackage(nestedFixtureRoot, "web-app").directory, /apps\/web$/);
    assert.match(resolveWorkspacePackage(nestedFixtureRoot, "api-service").directory, /services\/api$/);
    assert.throws(
      () => resolveWorkspacePackage(nestedFixtureRoot, "missing"),
      /Workspace package "missing" not found\. Available: api-service, ui-lib, web-app/,
    );
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

  it("merges package config over root config when --package is used", () => {
    const result = runScan([
      ".",
      "--cwd",
      nestedFixtureRoot,
      "--package",
      "web-app",
      "--rules",
      "large-component",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.totalIssues, 1);
    assert.match(parsed.issues[0].evidence.join("\n"), /Lines: \d+ \/ 1/);
    assert.match(parsed.issues[0].file, /^src\/Widget\.tsx$/);
  });

  it("lets CLI thresholds override package config overrides", () => {
    const result = runScan([
      ".",
      "--cwd",
      nestedFixtureRoot,
      "--package",
      "web-app",
      "--rules",
      "large-component",
      "--threshold",
      "large-component.maxLines=1000",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.summary.totalIssues, 0);
  });

  it("scopes --changed files to the selected workspace package", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-monorepo-changed-"));
    try {
      mkdirSync(join(dir, "packages", "api", "src"), { recursive: true });
      mkdirSync(join(dir, "packages", "web", "src"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }), "utf8");
      writeFileSync(join(dir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }), "utf8");
      writeFileSync(join(dir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }), "utf8");
      writeFileSync(join(dir, "packages", "api", "src", "index.ts"), "export const api = 1;\n", "utf8");
      writeFileSync(join(dir, "packages", "web", "src", "index.ts"), "export const web = 1;\n", "utf8");
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["-c", "user.name=DebtLens Test", "-c", "user.email=test@example.com", "commit", "-m", "base"], { cwd: dir, stdio: "ignore" });

      writeFileSync(join(dir, "packages", "api", "src", "index.ts"), "// TODO api only\nexport const api = 1;\n", "utf8");
      writeFileSync(join(dir, "packages", "web", "src", "index.ts"), "// TODO web outside package\nexport const web = 1;\n", "utf8");
      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--package",
        "api",
        "--changed",
        "HEAD",
        "--rules",
        "todo-comment",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.filesScanned, 1);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.match(parsed.issues[0].file, /^src\/index\.ts$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scopes --diff-base snapshot files to the selected workspace package", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-monorepo-diff-base-"));
    try {
      mkdirSync(join(dir, "packages", "api", "src"), { recursive: true });
      mkdirSync(join(dir, "packages", "web", "src"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }), "utf8");
      writeFileSync(join(dir, "packages", "api", "package.json"), JSON.stringify({ name: "api" }), "utf8");
      writeFileSync(join(dir, "packages", "web", "package.json"), JSON.stringify({ name: "web" }), "utf8");
      writeFileSync(join(dir, "packages", "api", "src", "index.ts"), "export const api = 1;\n", "utf8");
      writeFileSync(join(dir, "packages", "web", "src", "index.ts"), "export const web = 1;\n", "utf8");
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["-c", "user.name=DebtLens Test", "-c", "user.email=test@example.com", "commit", "-m", "base"], { cwd: dir, stdio: "ignore" });

      writeFileSync(join(dir, "packages", "api", "src", "index.ts"), "// TODO api only\nexport const api = 1;\n", "utf8");
      writeFileSync(join(dir, "packages", "web", "src", "index.ts"), "// TODO web outside package\nexport const web = 1;\n", "utf8");
      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--package",
        "api",
        "--diff-base",
        "HEAD",
        "--rules",
        "todo-comment",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.match(parsed.issues[0].file, /^src\/index\.ts$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("monorepo doctor --package", () => {
  it("prints the merged package target and effective thresholds", () => {
    const result = runDoctor([
      ".",
      "--cwd",
      nestedFixtureRoot,
      "--package",
      "web-app",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Config: .*monorepo-nested\/debtlens\.config\.json \+ .*monorepo-nested\/apps\/web\/debtlens\.config\.json/);
    assert.match(result.stdout, /Package: web-app/);
    assert.match(result.stdout, /Target: .*monorepo-nested\/apps\/web/);
    assert.match(result.stdout, /Thresholds: .*large-component\.maxLines=1/);
  });
});
