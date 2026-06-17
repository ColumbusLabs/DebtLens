# DebtLens VS Code Extension

This extension runs `debtlens scan --format json` for the current workspace folder and
shows findings in VS Code's Problems panel.

## Install From This Repository

1. Install the DebtLens CLI so `debtlens` is on your `PATH`, or set `debtlens.executable`
   to an absolute DebtLens CLI path.
2. Open `extensions/vscode` in VS Code.
3. Run **Developer: Install Extension from Location...** and select this folder.
4. Open a project folder and run **DebtLens: Scan Workspace** from the command palette.

The extension also scans the containing workspace folder on save by default.

## Settings

- `debtlens.executable`: DebtLens CLI executable to spawn. Defaults to `debtlens`.
- `debtlens.scanOnSave`: run a workspace scan when a file is saved. Defaults to `true`.
- `debtlens.extraArgs`: extra CLI args before `--format json`, for example
  `["--pack", "core,python"]`.

Findings are mapped to `DiagnosticCollection` entries using the shared DebtLens JSON
contract, so terminal, CI, SARIF, and VS Code diagnostics all read the same scan result.

Manual smoke test:

1. Open a fixture workspace that contains a known DebtLens finding.
2. Run **DebtLens: Scan Workspace**.
3. Confirm the Problems panel shows the expected finding.
4. Save a source file and confirm diagnostics refresh without duplicate entries.
