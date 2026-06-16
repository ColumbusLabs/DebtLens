import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    assert.match(result.stdout, /^<!-- debtlens-report -->\n## DebtLens findings/);
    assert.match(result.stdout, /### Grouped annotations/);
    assert.match(result.stdout, /<details><summary><code>src\/Dashboard\.tsx<\/code> - 1 finding<\/summary>/);
    assert.match(result.stdout, /\*\*Low\*\* Debt marker comment \(`todo-comment`\)/);
  });

  it("includes pr-comment in invalid format errors", () => {
    const result = runScan(["examples/react", "--format", "nope"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected terminal, json, markdown, pr-comment, sarif, html, or junit/);
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

describe("debtlens scan fail-on regression", () => {
  function withTempProject(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-regression-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("rejects --fail-on-regression without a baseline or diff base", () => {
    const result = runScan(["examples/react", "--fail-on-regression"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use --fail-on-regression with --baseline or --diff-base/);
  });

  it("fails when total issue count increases versus the baseline", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      writeFileSync(join(dir, "baseline.json"), JSON.stringify({
        version: 1,
        generatedAt: "2026-06-16T00:00:00.000Z",
        fingerprints: {},
        summary: {
          totalIssues: 0,
          bySeverity: { info: 0, low: 0, medium: 0, high: 0 },
          byRule: {},
        },
      }));

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--baseline",
        "baseline.json",
        "--fail-on-regression",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 1);
      assert.equal(parsed.summary.deltaFromBaseline.totalDelta, 1);
      assert.equal(parsed.summary.deltaFromBaseline.byRule["todo-comment"].delta, 1);
    });
  });

  it("does not fail when a new same-rule fingerprint replaces a resolved one without count growth", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      const writeBaselineResult = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--write-baseline",
        "baseline.json",
      ]);
      assert.equal(writeBaselineResult.status, 0);

      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after GA\nexport const value = 1;\n");
      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--baseline",
        "baseline.json",
        "--fail-on-regression",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.deltaFromBaseline.totalDelta, 0);
      assert.equal(parsed.summary.deltaFromBaseline.byRule["todo-comment"].delta, 0);
    });
  });

  it("does not fail unchanged legacy baselines that lack per-rule metadata", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      const writeBaselineResult = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--write-baseline",
        "baseline.json",
      ]);
      assert.equal(writeBaselineResult.status, 0);

      const baseline = JSON.parse(readFileSync(join(dir, "baseline.json"), "utf8"));
      delete baseline.summary;
      delete baseline.issues;
      writeFileSync(join(dir, "baseline.json"), JSON.stringify(baseline));

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--baseline",
        "baseline.json",
        "--fail-on-regression",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.deltaFromBaseline.totalDelta, 0);
      assert.equal(parsed.summary.deltaFromBaseline.hasBaselineSummary, false);
    });
  });

  it("fails when a baselined finding increases in severity", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      const writeBaselineResult = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--write-baseline",
        "baseline.json",
      ]);
      assert.equal(writeBaselineResult.status, 0);

      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        ruleSeverities: { "todo-comment": "high" },
      }));

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--baseline",
        "baseline.json",
        "--fail-on-regression",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 1);
      assert.equal(parsed.summary.deltaFromBaseline.changed, 1);
      assert.equal(parsed.summary.deltaFromBaseline.severityRegressions, 1);
    });
  });

  it("fails when a per-rule count increases even if total issue count is flat", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      writeFileSync(join(dir, "baseline.json"), JSON.stringify({
        version: 1,
        generatedAt: "2026-06-16T00:00:00.000Z",
        fingerprints: { dl_old_naming: 1 },
        summary: {
          totalIssues: 1,
          bySeverity: { info: 1, low: 0, medium: 0, high: 0 },
          byRule: { "naming-drift": 1 },
        },
      }));

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--baseline",
        "baseline.json",
        "--fail-on-regression",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 1);
      assert.equal(parsed.summary.deltaFromBaseline.totalDelta, 0);
      assert.equal(parsed.summary.deltaFromBaseline.byRule["todo-comment"].delta, 1);
      assert.equal(parsed.summary.deltaFromBaseline.byRule["naming-drift"].delta, -1);
    });
  });
});

describe("debtlens scan failOn from config", () => {
  function withTempProject(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-failon-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("gates the exit code from config-only failOn", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        failOn: "low",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 1);
    });
  });

  it("does not fail when config failOn severity is not met", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        failOn: "high",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 0);
    });
  });

  it("lets the --fail-on flag override config failOn", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        failOn: "low",
      }));

      const result = runScan([".", "--cwd", dir, "--fail-on", "high", "--format", "json"]);

      assert.equal(result.status, 0);
    });
  });

  it("rejects an invalid failOn severity in config", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        failOn: "critical",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Invalid severity "critical"/);
    });
  });
});

describe("debtlens scan inline suppressions", () => {
  function withTempProject(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-suppress-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("suppresses a matching next-line finding when a reason is provided", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "src", "Control.ts"), "// TODO remove after launch\n");
      writeFileSync(
        join(dir, "src", "Widget.ts"),
        "// debtlens-disable-next-line todo-comment -- tracked in PROJ-1\n// TODO remove after launch\n",
      );

      const control = JSON.parse(
        runScan(["src/Control.ts", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]).stdout,
      );
      const suppressed = JSON.parse(
        runScan(["src/Widget.ts", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]).stdout,
      );

      assert.equal(control.summary.totalIssues, 1);
      assert.equal(suppressed.summary.totalIssues, 0);
      assert.equal(suppressed.summary.filterStats?.suppressedByInline, 1);
      assert.equal(suppressed.suppressions[0].ruleId, "todo-comment");
      assert.equal(suppressed.suppressions[0].file, suppressed.suppressions[0].issue.file);
      assert.equal(suppressed.suppressions[0].kind, "next-line");
      assert.equal(suppressed.suppressions[0].reason, "tracked in PROJ-1");
      assert.equal(suppressed.suppressions[0].directiveLine, 1);
      assert.equal(suppressed.suppressions[0].targetLine, 2);
      assert.equal(suppressed.suppressions[0].issue.ruleId, "todo-comment");
      assert.equal(typeof suppressed.suppressions[0].issue.fingerprint, "string");
    });
  });

  it("does not suppress when the reason is missing", () => {
    withTempProject((dir) => {
      writeFileSync(
        join(dir, "src", "Widget.ts"),
        "// debtlens-disable-next-line todo-comment\n// TODO remove after launch\n",
      );

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.match(result.stderr, /reason is missing/);
    });
  });

  it("does not suppress when the rule id does not match", () => {
    withTempProject((dir) => {
      writeFileSync(
        join(dir, "src", "Widget.ts"),
        "// debtlens-disable-next-line naming-drift -- wrong rule\n// TODO remove after launch\n",
      );

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(parsed.summary.totalIssues, 1);
    });
  });

  it("suppresses all matching file-level findings for the configured rule", () => {
    withTempProject((dir) => {
      writeFileSync(
        join(dir, "src", "Widget.ts"),
        "// debtlens-disable-file todo-comment -- legacy rollout debt\n// TODO one\n// TODO two\n",
      );

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.filterStats?.suppressedByInline, 2);
    });
  });
});

describe("debtlens scan diff-base", () => {
  it("rejects --diff-base and --baseline together", () => {
    const result = runScan(["examples/react", "--diff-base", "HEAD~1", "--baseline", "baseline.json"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --diff-base or --baseline, not both/);
  });
});

describe("debtlens scan profile", () => {
  it("prints per-rule timing to stderr without changing findings", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--profile", "--format", "json"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /DebtLens profile \(per-rule ms\):/);
    assert.match(result.stderr, /todo-comment: \d+ms/);
    assert.ok(parsed.summary.profile?.ruleTimingsMs["todo-comment"] !== undefined);
    assert.equal(parsed.summary.totalIssues, parsed.issues.length);
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
