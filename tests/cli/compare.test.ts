import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = join(repoRoot, "src", "cli", "index.ts");

function runCompare(args: string[], options: { cwd?: string } = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntrypoint, "compare", ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });
}

describe("debtlens compare", () => {
  it("compares two ScanResult JSON reports in JSON format", () => withReports((dir, previousPath, currentPath) => {
    writeReport(previousPath, resultOf([
      issue({ id: "old", fingerprint: "old", ruleId: "todo-comment", file: "src/old.ts", severity: "low" }),
      issue({ id: "shared", fingerprint: "shared", ruleId: "state-sprawl", file: "src/App.tsx", severity: "medium" }),
    ]));
    writeReport(currentPath, resultOf([
      issue({ id: "shared", fingerprint: "shared", ruleId: "state-sprawl", file: "src/App.tsx", severity: "medium" }),
      issue({ id: "new-a", fingerprint: "new-a", ruleId: "todo-comment", file: "src/new.ts", severity: "low" }),
      issue({ id: "new-b", fingerprint: "new-b", ruleId: "prop-drilling", file: "src/new.ts", severity: "high" }),
    ]));

    const result = runCompare(["previous.json", "current.json", "--format", "json", "--cwd", dir]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.delta.total, 1);
    assert.equal(parsed.delta.new, 2);
    assert.equal(parsed.delta.resolved, 1);
    assert.equal(parsed.delta.bySeverity.find((entry: { severity: string }) => entry.severity === "high").delta, 1);
    assert.equal(parsed.delta.byRule.find((entry: { ruleId: string }) => entry.ruleId === "prop-drilling").delta, 1);
    assert.equal(parsed.topNewFiles[0].file, "src/new.ts");
    assert.equal(parsed.topNewFiles[0].count, 2);
  }));

  it("renders terminal and Markdown reports", () => withReports((dir, previousPath, currentPath) => {
    writeReport(previousPath, resultOf([
      issue({ id: "old", fingerprint: "old", ruleId: "todo-comment", file: "src/old.ts" }),
    ]));
    writeReport(currentPath, resultOf([
      issue({ id: "new", fingerprint: "new", ruleId: "prop-drilling", file: "src/new.ts", severity: "high" }),
    ]));

    const terminal = runCompare(["previous.json", "current.json", "--cwd", dir]);
    const markdown = runCompare(["previous.json", "current.json", "--format", "markdown", "--cwd", dir]);

    assert.equal(terminal.status, 0, terminal.stderr);
    assert.match(terminal.stdout, /DebtLens Compare/);
    assert.match(terminal.stdout, /Total delta: 0/);
    assert.match(terminal.stdout, /New: 1 \| Resolved: 1/);
    assert.match(terminal.stdout, /src\/new\.ts: 1 new/);
    assert.equal(markdown.status, 0, markdown.stderr);
    assert.match(markdown.stdout, /^# DebtLens Compare/);
    assert.match(markdown.stdout, /## Rule Delta/);
    assert.match(markdown.stdout, /\| `prop-drilling` \| 0 \| 1 \| \+1 \|/);
  }));

  it("warns but compares older reports missing schemaVersion and summary", () => withReports((dir, previousPath, currentPath) => {
    writeFileSync(previousPath, `${JSON.stringify({
      issues: [issue({ id: "legacy", fingerprint: undefined, file: "src/legacy.ts", message: "Legacy todo" })],
    })}\n`);
    writeFileSync(currentPath, `${JSON.stringify({
      issues: [issue({ id: "legacy-current", fingerprint: undefined, file: "src/legacy.ts", message: "Legacy todo" })],
    })}\n`);

    const result = runCompare(["previous.json", "current.json", "--format", "json", "--cwd", dir]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /missing or has incomplete summary counts/);
    assert.match(result.stderr, /schemaVersion: 1/);
    assert.equal(parsed.delta.total, 0);
    assert.equal(parsed.delta.new, 0);
    assert.equal(parsed.delta.resolved, 0);
  }));

  it("compares summary-only reports with unavailable exact metrics", () => withReports((dir, previousPath, currentPath) => {
    writeFileSync(previousPath, `${JSON.stringify({
      summary: {
        totalIssues: 1,
        bySeverity: { info: 0, low: 1, medium: 0, high: 0 },
        byRule: { "todo-comment": 1 },
      },
    })}\n`);
    writeFileSync(currentPath, `${JSON.stringify({
      summary: {
        totalIssues: 2,
        bySeverity: { info: 0, low: 1, medium: 0, high: 1 },
        byRule: { "todo-comment": 1, "prop-drilling": 1 },
      },
    })}\n`);

    const result = runCompare(["previous.json", "current.json", "--format", "json", "--cwd", dir]);
    const parsed = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.delta.total, 1);
    assert.equal(parsed.delta.resolved, null);
    assert.equal(parsed.accuracy.issueIdentity, "unavailable");
    assert.match(result.stderr, /best-effort defaults/);
  }));

  it("rejects unsupported compare formats and invalid reports", () => withReports((dir, previousPath, currentPath) => {
    writeReport(previousPath, resultOf([]));
    writeFileSync(currentPath, "{}\n");

    const badFormat = runCompare(["previous.json", "current.json", "--format", "sarif", "--cwd", dir]);
    const badReport = runCompare(["previous.json", "current.json", "--cwd", dir]);

    assert.equal(badFormat.status, 1);
    assert.match(badFormat.stderr, /Invalid compare format "sarif"/);
    assert.equal(badReport.status, 1);
    assert.match(badReport.stderr, /missing usable "summary" counts or "issues" array/);
  }));
});

function withReports(run: (dir: string, previousPath: string, currentPath: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "debtlens-compare-"));
  try {
    run(dir, join(dir, "previous.json"), join(dir, "current.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeReport(path: string, result: ScanResult): void {
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function resultOf(issues: ScanResult["issues"]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  const byRule: Record<string, number> = {};
  for (const finding of issues) {
    bySeverity[finding.severity] += 1;
    byRule[finding.ruleId] = (byRule[finding.ruleId] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule,
      filesScanned: 1,
      rulesRun: 3,
      elapsedMs: 1,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

function issue(overrides: Partial<DebtIssue> = {}): ScanResult["issues"][number] {
  return {
    id: "issue",
    fingerprint: "issue",
    ruleId: "todo-comment",
    ruleName: "Todo comment",
    severity: "low",
    confidence: 0.8,
    message: "Comment contains a todo marker.",
    file: "src/app.ts",
    location: { startLine: 1 },
    tags: [],
    ...overrides,
  };
}
