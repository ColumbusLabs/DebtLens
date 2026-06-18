import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { toRange, toSeverity, groupIssuesByUri } = require("../../extensions/vscode/diagnostics.js");

class MockRange {
  constructor(
    public startLine: number,
    public startColumn: number,
    public endLine: number,
    public endColumn: number,
  ) {}
}

class MockDiagnostic {
  constructor(
    public range: MockRange,
    public message: string,
    public severity: number,
  ) {}

  code?: string;
  source?: string;
}

const mockVscode = {
  Range: MockRange,
  Diagnostic: MockDiagnostic,
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  Uri: {
    file: (filePath: string) => ({
      fsPath: filePath,
      toString: () => `file://${filePath}`,
    }),
  },
};

const fixture = JSON.parse(readFileSync("tests/vscode/fixtures/scan-result.json", "utf8")) as {
  issues: Array<{
    ruleId: string;
    ruleName: string;
    severity: string;
    message: string;
    file: string;
    location?: { startLine?: number; startColumn?: number; endLine?: number; endColumn?: number };
  }>;
};

describe("VS Code diagnostics mapping", () => {
  it("maps DebtLens locations to zero-based editor ranges", () => {
    const range = toRange({ startLine: 3, startColumn: 5, endLine: 3, endColumn: 62 }, mockVscode);

    assert.equal(range.startLine, 2);
    assert.equal(range.startColumn, 4);
    assert.equal(range.endLine, 2);
    assert.equal(range.endColumn, 62);
  });

  it("defaults missing location fields to a single-line range", () => {
    const range = toRange(undefined, mockVscode);

    assert.equal(range.startLine, 0);
    assert.equal(range.startColumn, 0);
    assert.equal(range.endLine, 0);
    assert.equal(range.endColumn, 1);
  });

  it("maps DebtLens severities to VS Code diagnostic severities", () => {
    assert.equal(toSeverity("high", mockVscode), mockVscode.DiagnosticSeverity.Error);
    assert.equal(toSeverity("medium", mockVscode), mockVscode.DiagnosticSeverity.Warning);
    assert.equal(toSeverity("low", mockVscode), mockVscode.DiagnosticSeverity.Information);
    assert.equal(toSeverity("info", mockVscode), mockVscode.DiagnosticSeverity.Hint);
  });

  it("groups ScanResult issues by workspace file URI", () => {
    const workspaceRoot = "/workspace/examples/python/src";
    const grouped = groupIssuesByUri(workspaceRoot, fixture.issues, mockVscode);

    assert.equal(grouped.size, 1);
    const entry = [...grouped.values()][0];
    assert.equal(entry?.uri.toString(), `file://${workspaceRoot}/service.py`);
    assert.equal(entry?.diagnostics.length, 3);
    assert.equal(entry?.diagnostics[0]?.message, "Python debt marker comment: Debt marker comment found: TODO(PROJ-42).");
    assert.equal(entry?.diagnostics[0]?.code, "python-todo-comment");
    assert.equal(entry?.diagnostics[0]?.source, "DebtLens");
    assert.equal(entry?.diagnostics[1]?.severity, mockVscode.DiagnosticSeverity.Warning);
    assert.equal(entry?.diagnostics[2]?.severity, mockVscode.DiagnosticSeverity.Information);
  });
});
