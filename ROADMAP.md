# DebtLens Roadmap

## v0.1 — Runnable proof of concept

- TypeScript CLI with `debtlens scan`.
- Eight initial rules.
- Terminal, JSON, and Markdown reporters.
- JSON config file.
- Example React, React Native, and Next folders.

## v0.2 — Useful for real repositories

- Add tests for every detector.
- Add fixture snapshots for terminal/json/markdown reports.
- Add rule-level docs with false-positive examples.
- Improve duplicate detection with AST node fingerprints instead of text normalization only.
- Add `--baseline` support so teams can track newly introduced debt.
- Add `--changed` mode for pull request scanning.
- Add `--sarif` output for GitHub code scanning.

## v0.3 — Maintainer workflow integrations

- GitHub Action.
- PR comment mode with Markdown annotations grouped by file.
- Suggested refactor prompts for each issue.
- Rule config schema and generated docs.
- Monorepo/package-aware scanning.

## v0.4 — Ecosystem expansion

- Vue/Svelte detectors where applicable.
- Python duplicate/dead-abstraction detector.
- Configurable domain vocabulary for naming drift.
- Plugin API for third-party rules.
- Rule packs: `react`, `react-native`, `next`, `ai-assisted`, `oss-maintainer`.

## v1.0 — Stable maintainer tool

- Stable JSON output contract.
- Low false-positive defaults.
- SARIF, Markdown, JSON, terminal reporters.
- Baseline support.
- Documented plugin API.
- Public rule contribution process.
