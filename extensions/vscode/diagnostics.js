"use strict";

const path = require("node:path");

function getVscodeApi(vscodeApi) {
  return vscodeApi ?? require("vscode");
}

function toRange(location, vscodeApi) {
  const vscode = getVscodeApi(vscodeApi);
  const startLine = Math.max(0, (location?.startLine ?? 1) - 1);
  const startColumn = Math.max(0, (location?.startColumn ?? 1) - 1);
  const endLine = Math.max(startLine, (location?.endLine ?? location?.startLine ?? 1) - 1);
  const endColumn = Math.max(startColumn + 1, location?.endColumn ?? startColumn + 1);
  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function toSeverity(severity, vscodeApi) {
  const vscode = getVscodeApi(vscodeApi);
  switch (severity) {
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    case "low":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

function groupIssuesByUri(folderPath, issues, vscodeApi) {
  const vscode = getVscodeApi(vscodeApi);
  const diagnosticsByFile = new Map();

  for (const issue of issues) {
    const filePath = path.resolve(folderPath, issue.file);
    const uri = vscode.Uri.file(filePath);
    const diagnostic = new vscode.Diagnostic(
      toRange(issue.location, vscodeApi),
      `${issue.ruleName}: ${issue.message}`,
      toSeverity(issue.severity, vscodeApi),
    );
    diagnostic.code = issue.ruleId;
    diagnostic.source = "DebtLens";
    const key = uri.toString();
    const existing = diagnosticsByFile.get(key) ?? { uri, diagnostics: [] };
    existing.diagnostics.push(diagnostic);
    diagnosticsByFile.set(key, existing);
  }

  return diagnosticsByFile;
}

module.exports = { toRange, toSeverity, groupIssuesByUri };
