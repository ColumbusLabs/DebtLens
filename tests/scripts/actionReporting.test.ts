import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Action reporting scripts", () => {
  it("exports scan metrics and artifact outputs from the canonical JSON report", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-action-outputs-"));
    try {
      const reportPath = join(dir, "report.json");
      const outputPath = join(dir, "github-output.txt");
      writeFileSync(reportPath, JSON.stringify(makeReport()), "utf8");

      const result = spawnSync(process.execPath, ["scripts/export-action-outputs.mjs", reportPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          DEBTLENS_SCAN_STATUS: "1",
          DEBTLENS_JSON_OUTPUT: "reports/debtlens.json",
          DEBTLENS_UPLOAD_JSON_ARTIFACT: "true",
          DEBTLENS_JSON_ARTIFACT_NAME: "debt-metrics",
          DEBTLENS_REPORT_OUTPUT: "debtlens.sarif",
          DEBTLENS_REPORT_FORMAT: "sarif",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      const outputs = Object.fromEntries(readFileSync(outputPath, "utf8").trim().split("\n").map((line) => line.split("=")));
      assert.equal(outputs["scan-status"], "1");
      assert.equal(outputs["gate-status"], "failed");
      assert.equal(outputs["total-issues"], "3");
      assert.equal(outputs["high-issues"], "1");
      assert.equal(outputs["top-rule"], "todo-comment");
      assert.equal(outputs["top-rule-count"], "2");
      assert.equal(outputs["json-path"], "reports/debtlens.json");
      assert.equal(outputs["json-artifact-name"], "debt-metrics");
      assert.equal(outputs["report-path"], "debtlens.sarif");
      assert.equal(outputs["report-format"], "sarif");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exports fallback outputs when the canonical JSON report is unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-action-outputs-fallback-"));
    try {
      const outputPath = join(dir, "github-output.txt");

      const result = spawnSync(process.execPath, ["scripts/export-action-outputs.mjs", join(dir, "missing.json")], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          DEBTLENS_SCAN_STATUS: "1",
          DEBTLENS_JSON_PATH: "internal/debtlens.json",
          DEBTLENS_REPORT_OUTPUT: "debtlens.md",
          DEBTLENS_REPORT_FORMAT: "markdown",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /emitting fallback outputs/);
      const outputs = Object.fromEntries(readFileSync(outputPath, "utf8").trim().split("\n").map((line) => line.split("=")));
      assert.equal(outputs["scan-status"], "1");
      assert.equal(outputs["gate-status"], "failed");
      assert.equal(outputs["total-issues"], "0");
      assert.equal(outputs["json-path"], "internal/debtlens.json");
      assert.equal(outputs["report-path"], "debtlens.md");
      assert.equal(outputs["report-format"], "markdown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits capped escaped GitHub workflow annotations", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-annotations-"));
    try {
      const reportPath = join(dir, "report.json");
      writeFileSync(reportPath, JSON.stringify(makeReport()), "utf8");

      const result = spawnSync(process.execPath, ["scripts/emit-github-annotations.mjs", reportPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          DEBTLENS_ANNOTATIONS_MAX_COUNT: "2",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /::error file=src\/High%2COne\.tsx,line=4,title=DebtLens high prop-drilling::High issue%0Awith newline \(prop-drilling\)/);
      assert.match(result.stdout, /::warning file=src\/Todo\.ts,line=8,title=DebtLens low todo-comment::Low issue \(todo-comment\)/);
      assert.match(result.stdout, /::notice title=DebtLens annotations capped::1 finding\(s\) omitted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits repository-relative annotation paths for scoped targets", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-annotations-paths-"));
    try {
      const workspace = join(dir, "workspace");
      const reportPath = join(dir, "report.json");
      const report = makeReport();
      report.options.target = join(workspace, "packages", "app");
      report.issues = [{
        ...report.issues[0],
        file: "src/App.tsx",
      }];
      report.summary.totalIssues = 1;
      report.summary.bySeverity = { high: 1, medium: 0, low: 0, info: 0 };
      report.summary.byRule = { "prop-drilling": 1, "todo-comment": 0 };
      writeFileSync(reportPath, JSON.stringify(report), "utf8");

      const result = spawnSync(process.execPath, ["scripts/emit-github-annotations.mjs", reportPath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          DEBTLENS_ANNOTATIONS_MAX_COUNT: "5",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /::error file=packages\/app\/src\/App\.tsx,line=4,title=DebtLens high prop-drilling::/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits repository-relative annotation paths for scoped working directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-annotations-cwd-"));
    try {
      const workspace = join(dir, "workspace");
      const packageDir = join(workspace, "packages", "app");
      mkdirSync(packageDir, { recursive: true });
      const reportPath = join(dir, "report.json");
      const report = makeReport();
      report.options.target = ".";
      report.issues = [{
        ...report.issues[0],
        file: "src/App.tsx",
      }];
      report.summary.totalIssues = 1;
      report.summary.bySeverity = { high: 1, medium: 0, low: 0, info: 0 };
      report.summary.byRule = { "prop-drilling": 1, "todo-comment": 0 };
      writeFileSync(reportPath, JSON.stringify(report), "utf8");

      const result = spawnSync(process.execPath, [join(repoRoot, "scripts/emit-github-annotations.mjs"), reportPath], {
        cwd: packageDir,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          DEBTLENS_ANNOTATIONS_MAX_COUNT: "5",
        },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /::error file=packages\/app\/src\/App\.tsx,line=4,title=DebtLens high prop-drilling::/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function makeReport() {
  return {
    schemaVersion: 1,
    issues: [{
      id: "high",
      ruleId: "prop-drilling",
      ruleName: "Prop drilling",
      severity: "high",
      confidence: 0.9,
      message: "High issue\nwith newline",
      file: "src/High,One.tsx",
      location: { startLine: 4 },
      tags: [],
    }, {
      id: "low",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.8,
      message: "Low issue",
      file: "src/Todo.ts",
      location: { startLine: 8 },
      tags: [],
    }, {
      id: "low-2",
      ruleId: "todo-comment",
      ruleName: "Todo comment",
      severity: "low",
      confidence: 0.7,
      message: "Another low issue",
      file: "src/Todo.ts",
      location: { startLine: 12 },
      tags: [],
    }],
    summary: {
      totalIssues: 3,
      bySeverity: { high: 1, medium: 0, low: 2, info: 0 },
      byRule: { "todo-comment": 2, "prop-drilling": 1 },
      filesScanned: 3,
      rulesRun: 8,
      elapsedMs: 10,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info" },
  };
}
