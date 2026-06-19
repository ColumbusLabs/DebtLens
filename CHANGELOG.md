# Changelog

All notable changes to DebtLens are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- GitHub Action JSON artifact upload is now opt-in (`upload-json-artifact` defaults to
  `false`).
- **CLI layout** splits the monolithic `src/cli/index.ts` into per-command modules under
  `src/cli/commands/`, shared parsers in `src/cli/parse.ts`, and scan pipeline helpers in
  `src/cli/scanPipeline.ts` (no user-facing behavior change).
- **Python detectors** live under `src/detectors/python/` with `async def` parsing and decorator
  line skipping in function extraction.
- **MCP scan and doctor tools** call the scan and doctor pipelines in-process instead of
  spawning CLI subprocesses; `rules` and `explain` still use subprocesses.
- **Package config merge** now union-merges `include`, `exclude`, and `rules` arrays when
  `--package` overlays a workspace package config on the repo root.
- **Scan cache writes** use a temp file plus atomic rename so interrupted writes cannot
  truncate `.debtlens/cache.json`.
- **`config-drift` filesystem discovery** is capped by the `config-drift.maxConfigFiles`
  threshold (default 200) when globbing JSON configs from the scan target.
- **pnpm workspace discovery** parses `pnpm-workspace.yaml` with the `yaml` package instead
  of a hand-rolled line parser.
- Consolidated shared Next.js surface helpers and string utilities used by multiple
  detectors (no user-facing behavior change).
- **VS Code extension diagnostics** mapping (`toRange`, `toSeverity`, issue grouping) lives
  in `extensions/vscode/diagnostics.js` for isolated testing.

### Fixed

- **`--blame-age` with `--staged`** now warns that blame metadata is unavailable for staged
  blob scans instead of failing silently.
- **`--blame-age` outside git repos** uses `break` instead of `return` when blame lookup fails
  so enrichment does not exit the surrounding scan handler early.
- **`debtlens init --from-eslint`** rejects non-`.json` ESLint config paths with a clear
  migration error.
- **Watch mode** now discovers `debtlens.config.json` and `.debtlensrc.json` via
  `findConfigPath` and rescans through the shared argv/spawn helpers.
- **MCP `scan` and `doctor` tools** accept `cwd` so agents can target monorepo
  packages without changing the server process directory.
- **`--diff-base` with `--package`** now compares only files inside the selected
  workspace package instead of the entire repository snapshot.

### Security

- Tagged Action runtime downloads verify the published `debtlens-action-dist.tgz.sha256`
  checksum before extraction and fail closed when the checksum file is missing or mismatched.

### Added

- **`debtlens compare previous.json current.json`** report trend command for comparing
  two ScanResult JSON reports without rescanning, with terminal, Markdown, and JSON
  output plus scheduled trend-job docs ([#183](https://github.com/ColumbusLabs/DebtLens/issues/183)).
- **Shared `buildScanArgv` helper** and `SCAN_ARG_FLAGS` for watch, MCP, and shell
  completions so scan flags stay in sync with the CLI.
- **`spawnCliSync` with a 64MB output buffer** for watch and MCP subprocess scans.
- **`chokidar`-based watch mode** replacing recursive `fs.watch` for reliable file
  change detection across platforms.
- **`debtlens explain <rule>`** command printing rule docs, default thresholds, and
  false-positive guidance from `docs/rules.md` ([#145](https://github.com/ColumbusLabs/DebtLens/issues/145)).
- **Did-you-mean suggestions** for unknown rule ids in `--rules`, config `rules`, inline
  suppression directives, and `debtlens explain` ([#151](https://github.com/ColumbusLabs/DebtLens/issues/151)).
- **`failOn` config field** to set the CI exit-code severity policy in
  `debtlens.config.json`; the `--fail-on` CLI flag overrides it
  ([#106](https://github.com/ColumbusLabs/DebtLens/issues/106)).
- **`pluginApiVersion` and `plugins` config fields** with fail-fast runtime validation
  against the supported plugin API version
  ([#69](https://github.com/ColumbusLabs/DebtLens/issues/69)). The plugin API version is
  an integer bumped only on breaking `Detector`/`DetectorContext` changes; bumps are
  documented here and in `docs/plugin-api-rfc.md`.
- **Plugin loader** for local ESM rule plugins per the plugin API RFC: detectors are
  validated against the built-in `Detector` contract, rule id collisions fail fast, and
  paths cannot escape the config directory
  ([#68](https://github.com/ColumbusLabs/DebtLens/issues/68)).
- **`DEBTLENS_DISABLE_PLUGINS=1`** environment escape hatch for CI pipelines scanning
  untrusted repositories; built-in rules still run
  ([#71](https://github.com/ColumbusLabs/DebtLens/issues/71)).
- **Reference plugin** in `examples/plugin/` (no-console rule) with CI integration
  coverage ([#72](https://github.com/ColumbusLabs/DebtLens/issues/72)).
- **`debtlens/plugin` entry point** exporting `Detector`, `DetectorContext`, `DebtIssue`,
  `Severity`, and `DEBTLENS_PLUGIN_API_VERSION` for plugin authors
  ([#70](https://github.com/ColumbusLabs/DebtLens/issues/70)).
- **Plugin threshold defaults**: plugins can export a `thresholds` map merged after
  built-in defaults, so user config and `--threshold` still override
  ([#73](https://github.com/ColumbusLabs/DebtLens/issues/73)).
- **Plugin vocabulary groups**: plugins can export naming-drift `vocabulary` concept
  groups, overridden by user config groups with the same id
  ([#74](https://github.com/ColumbusLabs/DebtLens/issues/74)).
- **`ruleSeverities` config field** replacing the severity a rule reports, for
  downgrading noisy rules without disabling them; unknown rule ids warn with a
  did-you-mean suggestion ([#107](https://github.com/ColumbusLabs/DebtLens/issues/107)).
- **`ruleConfidenceFloors` config field** hiding findings from a rule below a minimum
  confidence, tracked under `summary.filterStats.filteredByConfidenceFloor`
  ([#108](https://github.com/ColumbusLabs/DebtLens/issues/108)).
- **`debtlens suppress`** helper printing a copy-paste inline suppression directive
  (`--rule`, `--reason`, optional `--file`)
  ([#146](https://github.com/ColumbusLabs/DebtLens/issues/146)).

## [0.3.0] - 2026-06-09

### Added

- **`debtlens adopt`** first-run adoption workflow with dry-run recommendations and optional
  config/baseline writes.
- **`debtlens doctor`** command to inspect resolved config and matched files without scanning.
- **Rule packs** (`core`, `react`, `react-native`, `next`) as config presets via `--pack` and
  `debtlens init --pack`.
- **Configurable `todo-comment` markers** with custom patterns, disabled defaults, and
  `replaceDefaults`.
- **Inline suppressions** via `debtlens-disable-next-line` and `debtlens-disable-file`
  comments with required reasons after `--`.
- **`--fail-on-confidence`** CLI flag, config field, and GitHub Action input for
  confidence-aware CI exit codes.
- **`--diff-base`** mode to report findings introduced since a git ref.
- **`--package`** monorepo scanning MVP for `packages/*` workspace layouts.
- **`--profile`** per-rule timing output without changing findings.
- **Filter stats** in scan summaries (`suppressedByBaseline`, `filteredByMinSeverity`,
  `suppressedByInline`) across terminal, JSON, Markdown, and PR-comment reporters.
- **GitHub Action** step summary output, PR comment upsert mode, and `fail-on-confidence` input.
- **Calibrated quality fixtures** for representative app shapes.
- **Performance benchmark suite** for scan fixtures.
- **Rule fix guidance** and refactor prompts in Markdown reports.
- **Plugin API RFC** in `docs/plugin-api-rfc.md`.

### Changed

- **`large-component`** now recognizes `memo`, `forwardRef`, and class components.
- **`naming-drift`** is quieter on domain-rich apps via `disableBuiltInVocabulary` and
  calibrated defaults.
- **`todo-comment`** skips `debtlens-disable-*` directive lines so suppression comments do
  not self-trigger findings.
- Contributor docs refreshed for completed roadmap; good-first issue queue is now historical.

## [0.2.0] - 2026-06-06

### Added
- **`debtlens rules`** command to list built-in rule ids, default severities, and
  descriptions in terminal or JSON format.
- **`--staged`** scan mode for pre-commit workflows. Staged scans read staged git blob
  contents, so unstaged edits in the same file are not reported.
- `effect-complexity` now covers `useLayoutEffect` and `useInsertionEffect` in addition
  to `useEffect`.
- `duplicate-logic` now emits an advisory warning when `duplicate-logic.maxSnippets`
  caps comparison coverage. JSON reports include the same warning under
  `summary.warnings`.

### Changed
- CLI `--version` and SARIF `tool.driver.version` now share the package version from
  `package.json`.
- Contributor issue docs now reflect completed issue status after the `0.2.0` batch.

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
