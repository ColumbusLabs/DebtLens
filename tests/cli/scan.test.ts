import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { packageVersion } from "../../src/utils/packageInfo.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function runScan(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return runCli(["scan", ...args], options);
}

describe("debtlens root commands", () => {
  it("prints the package.json version", () => {
    const result = runCli(["--version"]);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), packageVersion);
  });

  it("lists built-in rules in terminal format", () => {
    const result = runCli(["rules"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /large-component/);
    assert.match(result.stdout, /naming-drift/);
  });

  it("lists built-in rules in JSON format", () => {
    const result = runCli(["rules", "--format", "json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.rules.length, 8);
    assert.ok(parsed.rules.some((rule: { id: string }) => rule.id === "effect-complexity"));
  });
});

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

  it("warns when writing a baseline from a scan that reads zero files", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-"));
    try {
      const baselinePath = join(dir, "baseline.json");
      const result = runScan(["examples/react", "--include", "**/*.py", "--write-baseline", baselinePath]);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Wrote baseline with 0 issues/);
      assert.match(result.stderr, /DebtLens warning: scanned 0 files\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints duplicate-logic cap warnings to stderr and JSON summary", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "duplicate-logic",
      "--threshold",
      "duplicate-logic.maxSnippets=1",
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /DebtLens warning: duplicate-logic inspected 1 of/);
    assert.match(parsed.summary.warnings[0], /duplicate-logic inspected 1 of/);
  });
});

describe("debtlens scan output formats", () => {
  it("accepts pr-comment format", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--format", "pr-comment"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^## DebtLens findings/);
    assert.match(result.stdout, /### Grouped annotations/);
    assert.match(result.stdout, /#### `src\/Dashboard\.tsx`/);
    assert.match(result.stdout, /\*\*Low\*\* Debt marker comment \(`todo-comment`\)/);
  });

  it("includes pr-comment in invalid format errors", () => {
    const result = runScan(["examples/react", "--format", "nope"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected terminal, json, markdown, pr-comment, or sarif/);
  });

  it("links locations when GitHub source env is available", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--format", "pr-comment"], {
      env: {
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "ColumbusLabs/DebtLens",
        GITHUB_SHA: "abc123",
      },
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /\[`src\/Dashboard\.tsx:22`\]\(https:\/\/github\.com\/ColumbusLabs\/DebtLens\/blob\/abc123\/src\/Dashboard\.tsx#L22\)/,
    );
  });
});

describe("debtlens scan fail-on confidence", () => {
  it("does not fail when high-severity issues are below the confidence threshold", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "prop-drilling",
      "--fail-on",
      "high",
      "--fail-on-confidence",
      "0.8",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 0);
  });

  it("fails when high-severity issues meet the confidence threshold", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "prop-drilling",
      "--fail-on",
      "high",
      "--fail-on-confidence",
      "0.7",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 1);
  });

  it("preserves severity-only fail-on when confidence threshold is omitted", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "prop-drilling",
      "--fail-on",
      "high",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 1);
  });

  it("rejects invalid confidence thresholds", () => {
    const result = runScan(["examples/react", "--fail-on", "high", "--fail-on-confidence", "1.5"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected a confidence between 0 and 1/);
  });
});

describe("debtlens scan diff-base", () => {
  it("rejects --diff-base and --baseline together", () => {
    const result = runScan(["examples/react", "--diff-base", "HEAD~1", "--baseline", "baseline.json"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --diff-base or --baseline, not both/);
  });
});

describe("debtlens scan git modes", () => {
  it("rejects --changed and --staged together", () => {
    const result = runScan(["examples/react", "--changed", "--staged"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --staged or --changed, not both/);
  });

  it("scans staged blob contents instead of unstaged working-tree edits", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-git-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "export const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      writeFileSync(join(dir, "src", "Widget.ts"), "export const value = 2;\n");
      execFileSync("git", ["add", "src/Widget.ts"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "src", "Widget.ts"), "export const value = 2;\n// TODO unstaged only\n");

      const result = runScan([".", "--cwd", dir, "--staged", "--rules", "todo-comment", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports opt-in gitignore filtering", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-gitignore-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO ignored\nexport const ignored = 1;\n");
      writeFileSync(join(dir, "src", "kept.ts"), "// TODO kept\nexport const kept = 1;\n");

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--respect-gitignore",
        "--rules",
        "todo-comment",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].file, "src/kept.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports gitignore filtering from config", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-config-gitignore-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".gitignore"), "src/ignored.ts\n");
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        include: ["**/*.ts"],
        exclude: [],
        rules: ["todo-comment"],
        respectGitignore: true,
      }));
      writeFileSync(join(dir, "src", "ignored.ts"), "// TODO ignored\nexport const ignored = 1;\n");
      writeFileSync(join(dir, "src", "kept.ts"), "// TODO kept\nexport const kept = 1;\n");

      const result = runScan([".", "--cwd", dir, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].file, "src/kept.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
