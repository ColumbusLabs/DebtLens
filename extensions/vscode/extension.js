"use strict";

const cp = require("node:child_process");
const vscode = require("vscode");
const { groupIssuesByUri } = require("./diagnostics.js");

let collection;
let output;
const activeRunsByFolder = new Map();
const diagnosticUrisByFolder = new Map();

function activate(context) {
  collection = vscode.languages.createDiagnosticCollection("debtlens");
  output = vscode.window.createOutputChannel("DebtLens");

  context.subscriptions.push(collection, output);
  context.subscriptions.push(vscode.commands.registerCommand("debtlens.scanWorkspace", scanAllWorkspaceFolders));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    const config = vscode.workspace.getConfiguration("debtlens");
    if (!config.get("scanOnSave", true)) return;
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) scanWorkspaceFolder(folder);
  }));
}

function deactivate() {
  if (collection) collection.dispose();
  if (output) output.dispose();
}

async function scanAllWorkspaceFolders() {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showWarningMessage("DebtLens: open a workspace folder before scanning.");
    return;
  }

  await Promise.all(folders.map((folder) => scanWorkspaceFolder(folder)));
}

function scanWorkspaceFolder(folder) {
  const folderKey = folder.uri.toString();
  const runId = (activeRunsByFolder.get(folderKey) ?? 0) + 1;
  activeRunsByFolder.set(folderKey, runId);
  const config = vscode.workspace.getConfiguration("debtlens", folder.uri);
  const executable = config.get("executable", "debtlens");
  const extraArgs = config.get("extraArgs", []);
  const args = ["scan", ".", ...extraArgs, "--format", "json", "--cwd", folder.uri.fsPath];

  return new Promise((resolve) => {
    const child = cp.spawn(executable, args, {
      cwd: folder.uri.fsPath,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      output.appendLine(`Failed to start DebtLens: ${error.message}`);
      vscode.window.showErrorMessage(`DebtLens: ${error.message}`);
      resolve();
    });
    child.on("close", (code) => {
      if (activeRunsByFolder.get(folderKey) !== runId) {
        output.appendLine(`Ignored stale DebtLens scan for ${folder.name}.`);
        resolve();
        return;
      }
      if (stderr.trim()) output.appendLine(stderr.trim());
      if (!stdout.trim()) {
        if (code && code !== 0) {
          vscode.window.showErrorMessage(`DebtLens exited with code ${code}. See the DebtLens output panel.`);
        }
        resolve();
        return;
      }

      try {
        const result = JSON.parse(stdout);
        applyDiagnostics(folder, result.issues ?? []);
        if (code && code !== 0) {
          output.appendLine(`DebtLens exited with code ${code}; diagnostics were still updated from JSON output.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`Could not parse DebtLens JSON: ${message}`);
        output.appendLine(stdout);
        vscode.window.showErrorMessage("DebtLens: could not parse scanner JSON output.");
      }
      resolve();
    });
  });
}

function applyDiagnostics(folder, issues) {
  clearWorkspaceDiagnostics(folder);
  const diagnosticsByFile = groupIssuesByUri(folder.uri.fsPath, issues);

  for (const { uri, diagnostics } of diagnosticsByFile.values()) {
    collection.set(uri, diagnostics);
  }
  diagnosticUrisByFolder.set(folder.uri.toString(), [...diagnosticsByFile.values()].map(({ uri }) => uri));
}

function clearWorkspaceDiagnostics(folder) {
  const folderKey = folder.uri.toString();
  for (const uri of diagnosticUrisByFolder.get(folderKey) ?? []) {
    collection.delete(uri);
  }
  diagnosticUrisByFolder.delete(folderKey);
}

module.exports = { activate, deactivate };
