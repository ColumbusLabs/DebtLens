# Changelog

All notable changes to DebtLens are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-06-01

### Added
- **`--quiet` / `-q`** on `debtlens scan`: terminal output shows header and summary
  counts only; individual findings are suppressed. Exit codes and `--fail-on` are unchanged.
- **Configurable prop-drilling ignores** via `propDrilling.ignoreComponents` in
  `debtlens.config.json` (extends the built-in host-component list).

### Changed
- Contributor docs: [`docs/good-first-issues.md`](./docs/good-first-issues.md) links to
  GitHub issues #1–#28.

## [0.1.0] - 2026-06-01

First public release.

### Added
- `debtlens scan` with 8 maintainability rules: `large-component`, `state-sprawl`,
  `effect-complexity`, `duplicate-logic`, `dead-abstraction`, `prop-drilling`,
  `todo-comment`, `naming-drift`.
- Output formats: terminal, JSON, Markdown, and **SARIF 2.1.0** (for GitHub code scanning).
- `debtlens init` to scaffold a `debtlens.config.json`.
- **Baseline mode** (`--write-baseline` / `--baseline`) with line-shift-stable
  fingerprints, so teams can adopt on legacy code and only see newly introduced debt.
- **`--changed [ref]`** mode to scan only files changed vs HEAD or a base ref (PR scans).
- Configurable naming-drift **vocabulary** (concept id → terms), merged with a built-in pack.
- Structural **AST fingerprint** pre-filter for `duplicate-logic` (precision + speed).
- JSON config with a generated **JSON Schema** (`schema/debtlens.config.schema.json`).
- A composite **GitHub Action** (`action.yml`).
- Test suite (`node:test` via `tsx`) and CI on a Node 20 + 22 matrix.

### Notes
- DebtLens reports **heuristic signals, not proof of defects**, and makes no claim about
  how code was authored.
- See [`docs/showcase-expensify-app.md`](docs/showcase-expensify-app.md) for a curated
  run against a large production React Native codebase.
