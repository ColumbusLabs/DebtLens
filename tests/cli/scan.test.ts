import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { allDetectors } from "../../src/detectors/index.js";
import { packageVersion } from "../../src/utils/packageInfo.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");
const localRequire = createRequire(import.meta.url);
const tsxLoader = localRequire.resolve("tsx");

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, ["--import", tsxLoader, cliEntrypoint, ...args], {
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
    assert.equal(parsed.rules.length, allDetectors.length);
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

  it("prints max-files truncation warnings to stderr and JSON summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-maxfiles-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n");
      writeFileSync(join(dir, "src", "c.ts"), "export const c = 1;\n");

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--max-files",
        "2",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.filesScanned, 2);
      assert.match(result.stderr, /DebtLens warning: DebtLens scanned the first 2 of 3 matched files/);
      assert.match(parsed.summary.warnings[0], /DebtLens scanned the first 2 of 3 matched files/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not follow symlinked source files outside the scan target", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-symlink-"));
    try {
      mkdirSync(join(dir, "scan"));
      mkdirSync(join(dir, "outside"));
      writeFileSync(join(dir, "outside", "secret.ts"), "// TODO outside target\nexport const secret = true;\n", "utf8");
      symlinkSync(join(dir, "outside", "secret.ts"), join(dir, "scan", "leak.ts"));

      const result = runScan([
        "scan",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.filesScanned, 0);
      assert.equal(parsed.summary.totalIssues, 0);
      assert.match(result.stderr, /DebtLens warning: scanned 0 files/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    assert.match(result.stderr, /Expected terminal, json, markdown, pr-comment, sarif, html, junit, gitlab-codequality, or badge/);
  });

  it("emits GitLab Code Quality JSON from CLI flags", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--format", "gitlab-codequality"]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].check_name, "todo-comment");
    assert.equal(parsed[0].severity, "minor");
    assert.equal(parsed[0].location.path, "examples/react/src/Dashboard.tsx");
    assert.equal(parsed[0].location.lines.begin, 22);
    assert.equal(typeof parsed[0].fingerprint, "string");
    assert.match(parsed[0].description, /todo marker/);
  });

  it("emits GitLab Code Quality repository-relative paths when --cwd is external", () => {
    const externalCwd = mkdtempSync(join(tmpdir(), "debtlens-cli-cwd-"));
    try {
      const result = runScan([
        "examples/react",
        "--cwd",
        repoRoot,
        "--rules",
        "todo-comment",
        "--format",
        "gitlab-codequality",
      ], { cwd: externalCwd });
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed[0].location.path, "examples/react/src/Dashboard.tsx");
    } finally {
      rmSync(externalCwd, { recursive: true, force: true });
    }
  });

  it("passes the JUnit failure threshold from CLI flags", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "todo-comment",
      "--format",
      "junit",
      "--junit-fail-on",
      "high",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /<testsuites name="DebtLens" tests="1" failures="0" skipped="1">/);
    assert.match(result.stdout, /<skipped message="\[todo-comment\] Comment contains a todo marker\./);
    assert.doesNotMatch(result.stdout, /<failure type="low"/);
  });

  it("emits SARIF partial fingerprints and category from CLI flags", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "todo-comment",
      "--format",
      "sarif",
      "--sarif-category",
      "packages/web",
    ]);
    const parsed = JSON.parse(result.stdout);
    const [finding] = parsed.runs[0].results;

    assert.equal(result.status, 0);
    assert.equal(parsed.runs[0].automationDetails.id, "packages/web");
    assert.equal(finding.partialFingerprints.debtLensFingerprint, finding.properties.fingerprint);
  });

  it("links locations when GitHub source env is available", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--format", "pr-comment"], {
      env: {
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "ColumbusLabs/DebtLens",
        GITHUB_SHA: "abc123",
        GITHUB_EVENT_PATH: "",
      },
    });

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /\[`src\/Dashboard\.tsx:22`\]\(https:\/\/github\.com\/ColumbusLabs\/DebtLens\/blob\/abc123\/src\/Dashboard\.tsx#L22\)/,
    );
  });

  it("prefers pull request head repository and SHA for PR comment source links", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-event-"));
    try {
      const eventPath = join(dir, "event.json");
      writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { repo: { full_name: "ForkOwner/DebtLens" }, sha: "head123" } } }), "utf8");
      const result = runScan(["examples/react", "--rules", "todo-comment", "--format", "pr-comment"], {
        env: {
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "ColumbusLabs/DebtLens",
          GITHUB_SHA: "merge456",
          GITHUB_EVENT_PATH: eventPath,
        },
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /github\.com\/ForkOwner\/DebtLens\/blob\/head123\/src\/Dashboard\.tsx#L22/);
      assert.doesNotMatch(result.stdout, /blob\/merge456/);
      assert.doesNotMatch(result.stdout, /github\.com\/ColumbusLabs\/DebtLens\/blob\/head123/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps PR comment details from CLI flags", () => {
    const result = runScan([
      "examples/react",
      "--min-severity",
      "info",
      "--format",
      "pr-comment",
      "--pr-comment-max-findings",
      "1",
      "--pr-comment-full-report-url",
      "https://example.test/debtlens-report",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /### Omitted finding summary/);
    assert.match(result.stdout, /Full details: https:\/\/example\.test\/debtlens-report\./);
  });

  it("allows PR comment detail caps to omit every grouped annotation", () => {
    const result = runScan([
      "examples/react",
      "--min-severity",
      "info",
      "--format",
      "pr-comment",
      "--pr-comment-max-findings",
      "0",
    ]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /configured 0-finding detail cap/);
    assert.doesNotMatch(result.stdout, /### Grouped annotations/);
  });

  it("emits badge SVG and writes shields endpoint JSON with --output", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-badge-"));
    try {
      const svgPath = join(dir, "debtlens-badge.svg");
      const result = runScan([
        "examples/react",
        "--rules",
        "todo-comment",
        "--format",
        "badge",
        "--output",
        svgPath,
      ]);

      assert.equal(result.status, 0);
      const svg = readFileSync(svgPath, "utf8");
      assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
      const json = JSON.parse(readFileSync(join(dir, "debtlens-badge.json"), "utf8")) as { schemaVersion: number; color: string };
      assert.equal(json.schemaVersion, 1);
      assert.ok(["brightgreen", "yellow", "red"].includes(json.color));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes shields endpoint JSON when badge output path ends in .json", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-badge-json-"));
    try {
      const jsonPath = join(dir, "debtlens-badge.json");
      const result = runScan([
        "examples/react",
        "--rules",
        "todo-comment",
        "--format",
        "badge",
        "--output",
        jsonPath,
      ]);

      assert.equal(result.status, 0);
      const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { schemaVersion: number; label: string };
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.label, "debt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails the gate when a configured budget is breached", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-budget-"));
    try {
      const configPath = join(dir, "debtlens.config.json");
      writeFileSync(configPath, JSON.stringify({
        rules: ["todo-comment"],
        budgets: { "src": { maxIssues: 0 } },
      }));
      const result = runScan(["examples/react", "--config", configPath, "--format", "json"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DebtLens budget breach/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints budget report without failing when --budget-report is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-budget-report-"));
    try {
      const configPath = join(dir, "debtlens.config.json");
      writeFileSync(configPath, JSON.stringify({
        rules: ["todo-comment"],
        budgets: { "src": { maxIssues: 0 } },
      }));
      const result = runScan(["examples/react", "--config", configPath, "--budget-report"]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /Area budget report/);
      assert.match(result.stdout, /BREACH/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("debtlens scan gate presets", () => {
  function withTempProject(run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-gate-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove after launch\nexport const value = 1;\n");
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("rejects an unknown gate preset", () => {
    const result = runScan(["examples/react", "--gate", "block-everything"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid gate preset "block-everything"/);
  });

  it("expands the legacy-baseline preset to the default baseline path", () => {
    withTempProject((dir) => {
      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--gate", "legacy-baseline"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Baseline file not found at .*debtlens-baseline\.json/);
    });
  });

  it("does not apply baseline defaults while writing a baseline", () => {
    withTempProject((dir) => {
      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--gate",
        "legacy-baseline",
        "--write-baseline",
      ]);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Wrote baseline with 1 issues/);
    });
  });

  it("expands strict-new-code enough to satisfy regression validation", () => {
    const result = runScan(["examples/react", "--rules", "todo-comment", "--gate", "strict-new-code", "--format", "json"]);

    assert.doesNotMatch(result.stderr, /Use --fail-on-regression with --baseline or --diff-base/);
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

  it("rejects schema-invalid config during scan", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        maxFiles: "abc",
        rules: ["todo-comment"],
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /config schema validation failed/);
      assert.match(result.stderr, /maxFiles must be a positive integer/);
    });
  });

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
      assert.match(result.stderr, /config schema validation failed/);
      assert.match(result.stderr, /failOn must be one of info, low, medium, high/);
    });
  });

  it("rejects an invalid gate preset in config with a clear error", () => {
    withTempProject((dir) => {
      writeFileSync(join(dir, "debtlens.config.json"), JSON.stringify({
        rules: ["todo-comment"],
        gatePreset: "block-everything",
      }));

      const result = runScan([".", "--cwd", dir, "--format", "json"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /config schema validation failed/);
      assert.match(result.stderr, /gatePreset must be one of advisory, new-code, strict-new-code, legacy-baseline/);
      assert.doesNotMatch(result.stderr, /Cannot read properties/);
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
      assert.equal(suppressed.suppressionDirectives, undefined);
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

  it("audits used and unused suppression directives when requested", () => {
    withTempProject((dir) => {
      writeFileSync(
        join(dir, "src", "Widget.ts"),
        "// debtlens-disable-file todo-comment -- legacy rollout debt\n// TODO one\n// TODO two\n",
      );
      writeFileSync(
        join(dir, "src", "Stale.ts"),
        "// debtlens-disable-next-line todo-comment -- stale exception\nconst ok = true;\n",
      );
      writeFileSync(
        join(dir, "src", "NotRun.ts"),
        "// debtlens-disable-next-line naming-drift -- domain term\nconst ok = true;\n",
      );

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--audit-suppressions", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.filterStats?.suppressedByInline, 2);
      assert.equal(parsed.suppressions.length, 2);
      const fileWide = parsed.suppressionDirectives.find((directive: { file: string }) => directive.file.endsWith("Widget.ts"));
      const unused = parsed.suppressionDirectives.find((directive: { file: string }) => directive.file.endsWith("Stale.ts"));
      const notEvaluated = parsed.suppressionDirectives.find((directive: { file: string }) => directive.file.endsWith("NotRun.ts"));
      assert.equal(fileWide.kind, "file");
      assert.equal(fileWide.status, "used");
      assert.equal(fileWide.suppressedIssueCount, 2);
      assert.match(fileWide.recommendedAction, /file-wide suppression can be narrowed/);
      assert.equal(unused.kind, "next-line");
      assert.equal(unused.status, "unused");
      assert.equal(unused.targetLine, 2);
      assert.equal(unused.reason, "stale exception");
      assert.match(unused.recommendedAction, /Remove this suppression/);
      assert.equal(notEvaluated.ruleId, "naming-drift");
      assert.equal(notEvaluated.status, "not-evaluated");
      assert.match(notEvaluated.recommendedAction, /Run this rule/);
    });
  });
});

describe("debtlens scan diff-base", () => {
  it("rejects --diff-base and --baseline together", () => {
    const result = runScan(["examples/react", "--diff-base", "HEAD~1", "--baseline", "baseline.json"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --diff-base or --baseline, not both/);
  });

  it("baselines unchanged Python findings with --diff-base", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-diff-python-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.py"), "# TODO committed python debt\ndef handler():\n    return True\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--pack",
        "python",
        "--diff-base",
        "HEAD",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.deltaFromBaseline.current.totalIssues, 1);
      assert.equal(parsed.summary.deltaFromBaseline.new, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("baselines unchanged Ruby findings with --diff-base", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-diff-ruby-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "lib"));
      writeFileSync(join(dir, "lib", "app.rb"), "# TODO committed ruby debt\nclass App\nend\n", "utf8");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--pack",
        "ruby",
        "--diff-base",
        "HEAD",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.deltaFromBaseline.current.totalIssues, 1);
      assert.equal(parsed.summary.deltaFromBaseline.new, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("debtlens scan performance flags", () => {
  it("passes cache, parallel, and batch-size options through merged config", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-performance-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO remove later\nexport const value = 1;\n");

      const first = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--cache",
        ".debtlens/cache.json",
        "--parallel",
        "--batch-size",
        "1",
        "--format",
        "json",
      ]);
      const second = runScan([
        ".",
        "--cwd",
        dir,
        "--rules",
        "todo-comment",
        "--cache",
        ".debtlens/cache.json",
        "--parallel",
        "--batch-size",
        "1",
        "--format",
        "json",
      ]);
      const firstJson = JSON.parse(first.stdout);
      const secondJson = JSON.parse(second.stdout);

      assert.equal(first.status, 0);
      assert.equal(firstJson.summary.performance.cache.hit, false);
      assert.equal(firstJson.summary.performance.parallel, true);
      assert.equal(firstJson.summary.performance.batchSize, 1);
      assert.equal(second.status, 0);
      assert.equal(secondJson.summary.performance.cache.hit, true);
      assert.equal(secondJson.summary.totalIssues, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("debtlens scan git modes", () => {
  it("rejects --changed and --staged together", () => {
    const result = runScan(["examples/react", "--changed", "--staged"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --staged or --changed, not both/);
  });

  it("does not leak old test-duplication findings into docs-only changed scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-changed-tests-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "docs"));
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "docs", "README.md"), "# docs\n", "utf8");
      writeFileSync(join(dir, "src", "a.test.ts"), `
        test("creates invoice", () => {
          const invoice = createInvoice({ total: 10 });
          expect(invoice.total).toBe(10);
          expect(invoice.status).toBe("open");
        });
      `, "utf8");
      writeFileSync(join(dir, "src", "b.test.ts"), `
        test("creates receipt", () => {
          const receipt = createInvoice({ total: 10 });
          expect(receipt.total).toBe(10);
          expect(receipt.status).toBe("open");
        });
      `, "utf8");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      writeFileSync(join(dir, "docs", "README.md"), "# docs\n\nChanged only docs.\n", "utf8");

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--changed",
        "HEAD",
        "--rules",
        "test-duplication",
        "--threshold",
        "test-duplication.minLines=2",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.filesScanned, 0);
      assert.equal(parsed.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not leak old config-drift findings into docs-only changed scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-changed-config-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "docs"));
      mkdirSync(join(dir, "packages", "app"), { recursive: true });
      mkdirSync(join(dir, "packages", "web"), { recursive: true });
      writeFileSync(join(dir, "docs", "README.md"), "# docs\n", "utf8");
      writeFileSync(join(dir, "packages", "app", "package.json"), JSON.stringify({
        scripts: { build: "vite build" },
      }), "utf8");
      writeFileSync(join(dir, "packages", "web", "package.json"), JSON.stringify({
        scripts: { build: "next build" },
      }), "utf8");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      writeFileSync(join(dir, "docs", "README.md"), "# docs\n\nChanged only docs.\n", "utf8");

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--changed",
        "HEAD",
        "--rules",
        "config-drift",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.filesScanned, 0);
      assert.equal(parsed.summary.totalIssues, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("warns when --blame-age is combined with --staged scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-blame-staged-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO staged marker\nexport const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO staged marker\nexport const value = 2;\n");
      execFileSync("git", ["add", "src/Widget.ts"], { cwd: dir, stdio: "ignore" });

      const result = runScan([
        ".",
        "--cwd",
        dir,
        "--staged",
        "--blame-age",
        "--rules",
        "todo-comment",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.match(result.stderr, /--blame-age ignored when scanning staged blob contents/);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].introducedDaysAgo, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds optional git blame age metadata to JSON findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-blame-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO committed marker\nexport const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--blame-age", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(typeof parsed.issues[0].introducedDaysAgo, "number");
      assert.ok(parsed.issues[0].introducedDaysAgo >= 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves blame age when findings are relative to a scanned subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-blame-subdir-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO subdir marker\nexport const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });

      const result = runScan(["src", "--cwd", dir, "--rules", "todo-comment", "--blame-age", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.issues[0].file, "Widget.ts");
      assert.equal(typeof parsed.issues[0].introducedDaysAgo, "number");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores blame age enrichment outside git repositories", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-blame-plain-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO plain marker\nexport const value = 1;\n");

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--blame-age", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.match(result.stderr, /--blame-age ignored \(not a git repository\)/);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.issues[0].introducedDaysAgo, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds optional git churn hotspots to JSON summaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-hotspots-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "hot.ts"), "// TODO hot file\nexport const hot = 1;\n");
      writeFileSync(join(dir, "src", "stable.ts"), "// TODO stable file\nexport const stable = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "src", "hot.ts"), "// TODO hot file\nexport const hot = 2;\nexport const extra = 3;\n");
      execFileSync("git", ["add", "src/hot.ts"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "update hot"], { cwd: dir, stdio: "ignore" });

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--hotspots", "--churn-days", "30", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.hotspots.source, "git");
      assert.equal(parsed.summary.hotspots.window.days, 30);
      assert.equal(parsed.summary.hotspots.ranking[0].file, "src/hot.ts");
      assert.ok(parsed.summary.hotspots.ranking[0].churn.commits >= 2);
      assert.match(parsed.summary.hotspots.ranking[0].reasons.join("; "), /recent commits/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses an explicit git churn range when provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-hotspot-range-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO range marker\nexport const value = 1;\n");
      execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
      const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO range marker\nexport const value = 2;\n");
      execFileSync("git", ["add", "src/Widget.ts"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "update widget"], { cwd: dir, stdio: "ignore" });

      const range = `${base}..HEAD`;
      const result = runScan(["src", "--cwd", dir, "--rules", "todo-comment", "--churn-range", range, "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.hotspots.window.range, range);
      assert.equal(parsed.summary.hotspots.ranking[0].file, "Widget.ts");
      assert.equal(parsed.summary.hotspots.ranking[0].repositoryPath, "src/Widget.ts");
      assert.equal(parsed.summary.hotspots.ranking[0].churn.commits, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous git churn windows", () => {
    const result = runScan([
      "examples/react",
      "--rules",
      "todo-comment",
      "--hotspots",
      "--churn-days",
      "30",
      "--churn-range",
      "HEAD",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use either --churn-days or --churn-range, not both/);
  });

  it("ignores hotspot enrichment outside git repositories", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-hotspots-plain-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO plain marker\nexport const value = 1;\n");

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--hotspots", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.match(result.stderr, /--hotspots ignored \(not a git repository\)/);
      assert.equal(parsed.summary.totalIssues, 1);
      assert.equal(parsed.summary.hotspots, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds optional CODEOWNERS ownership summaries to JSON scans", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-ownership-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, ".github"));
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "src/owned.ts @app/frontend\n");
      writeFileSync(join(dir, "src", "owned.ts"), "// TODO owned\nexport const owned = 1;\n");
      writeFileSync(join(dir, "src", "orphan.ts"), "// TODO orphan\nexport const orphan = 1;\n");

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--ownership", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(parsed.summary.ownership.source, "codeowners");
      assert.match(parsed.summary.ownership.codeownersPath, /\.github\/CODEOWNERS$/);
      assert.deepEqual(parsed.summary.ownership.files.find((file: { file: string }) => file.file === "src/owned.ts").owners, ["@app/frontend"]);
      assert.equal(parsed.summary.ownership.ownerSummaries[0].owner, "@app/frontend");
      assert.deepEqual(parsed.summary.ownership.unownedHotspots.map((file: { file: string }) => file.file), ["src/orphan.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers repository-root CODEOWNERS when scanning from a package directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-ownership-package-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, ".github"));
      mkdirSync(join(dir, "packages", "ui", "src"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "packages/ui/src/owned.ts @ui\n");
      writeFileSync(join(dir, "packages", "ui", "src", "owned.ts"), "// TODO package owner\nexport const owned = 1;\n");

      const packageDir = join(dir, "packages", "ui");
      const result = runScan([".", "--cwd", packageDir, "--rules", "todo-comment", "--ownership", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.equal(parsed.summary.ownership.codeownersPath, join(realpathSync(dir), ".github", "CODEOWNERS"));
      assert.deepEqual(parsed.summary.ownership.files.map((file: { file: string; repositoryPath: string; owners: string[] }) => [
        file.file,
        file.repositoryPath,
        file.owners,
      ]), [["src/owned.ts", "packages/ui/src/owned.ts", ["@ui"]]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps repository-relative matching for explicit CODEOWNERS from a package directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-ownership-explicit-package-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      mkdirSync(join(dir, ".github"));
      mkdirSync(join(dir, "packages", "ui", "src"), { recursive: true });
      writeFileSync(join(dir, ".github", "CODEOWNERS"), "packages/ui/src/owned.ts @ui\n");
      writeFileSync(join(dir, "packages", "ui", "src", "owned.ts"), "// TODO package explicit owner\nexport const owned = 1;\n");

      const packageDir = join(dir, "packages", "ui");
      const result = runScan([
        ".",
        "--cwd",
        packageDir,
        "--rules",
        "todo-comment",
        "--codeowners",
        "../../.github/CODEOWNERS",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(parsed.summary.ownership.files.map((file: { file: string; repositoryPath: string; owners: string[] }) => [
        file.file,
        file.repositoryPath,
        file.owners,
      ]), [["src/owned.ts", "packages/ui/src/owned.ts", ["@ui"]]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports explicit CODEOWNERS paths outside git repositories", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-codeowners-explicit-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "OWNERS"), "src/* dev@example.com\n");
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO explicit owner\nexport const value = 1;\n");

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--codeowners", "OWNERS", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      assert.equal(parsed.summary.ownership.ownerSummaries[0].owner, "dev@example.com");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps missing CODEOWNERS warning-free unless ownership is requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-codeowners-missing-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "// TODO missing owner\nexport const value = 1;\n");

      const defaultResult = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--format", "json"]);
      const requestedResult = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--ownership", "--format", "json"]);
      const parsed = JSON.parse(defaultResult.stdout);

      assert.equal(defaultResult.status, 0);
      assert.equal(defaultResult.stderr, "");
      assert.equal(parsed.summary.ownership, undefined);
      assert.equal(requestedResult.status, 0);
      assert.match(requestedResult.stderr, /--ownership ignored \(CODEOWNERS not found\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns for requested ownership with missing CODEOWNERS even when there are no findings", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-cli-codeowners-clean-missing-"));
    try {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "Widget.ts"), "export const value = 1;\n");

      const result = runScan([".", "--cwd", dir, "--rules", "todo-comment", "--ownership", "--format", "json"]);
      const parsed = JSON.parse(result.stdout);

      assert.equal(result.status, 0);
      assert.match(result.stderr, /--ownership ignored \(CODEOWNERS not found\)/);
      assert.equal(parsed.summary.totalIssues, 0);
      assert.equal(parsed.summary.ownership, undefined);
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
