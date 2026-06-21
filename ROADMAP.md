# DebtLens Roadmap

DebtLens is a **maintainability scanner** for TypeScript, JavaScript, Python, Vue/Svelte SFC scripts, Kotlin, Swift, and Jetpack Compose today,
with additional languages (Ruby, …) planned as language packs.
React was the first framework pack; React Native, Next.js, Expo, Node, Python, Vue/Svelte SFC scripts, Kotlin, Swift,
Jetpack Compose, and plain TS/JS projects are current supported targets, not the product identity. See
[`docs/rule-packs.md`](./docs/rule-packs.md) and [`docs/pack-chooser.md`](./docs/pack-chooser.md)
for the current support matrix, future languages, and contribution paths.

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

## v0.3 — Maintainer workflow integrations (shipped)

- GitHub Action with SARIF, step summary, PR comment upsert, and `fail-on-confidence`.
- PR comment mode with Markdown annotations grouped by file.
- Suggested refactor prompts and rule fix guidance in reports.
- Rule config schema, rule packs, and `debtlens doctor`.
- Monorepo/package-aware scanning (`--package` MVP).
- First-run adoption workflow (`debtlens adopt`).
- Inline suppressions with required reasons.
- Filter stats in scan summaries (baseline, min-severity, inline suppressions).
- `--diff-base` for branch-introduced findings.
- Scan profiling (`--profile`) and calibrated quality fixtures.

## v0.4 — Ecosystem expansion

- Optional rule packs in config (`core`, `react`, `react-native`, `next`, `node`) — **partially shipped in v0.3**.
- **Vue and Svelte SFC script packs** — script TODO, large-script, and duplicate-logic signals with original component line mapping.
- **First non-JS language pack: Python** — duplicate/dead-abstraction/TODO rules; same `ScanResult` and SARIF contract as TS/JS.
- **Kotlin core pack** — duplicate/large-function/dead-abstraction/TODO rules; same `ScanResult` and SARIF contract as TS/JS.
- **Jetpack Compose pack** — oversized composables and local state-hoisting smells; same `ScanResult` and SARIF contract as TS/JS.
- Configurable domain vocabulary for naming drift.
- Plugin API for third-party rules ([#26](https://github.com/ColumbusLabs/DebtLens/issues/26)).
- Maintainer-oriented packs: `ai-assisted`, `oss-maintainer`.

## v0.5 — Additional language packs

- **Swift core pack** — duplicate/large-function/dead-abstraction/TODO rules for `.swift` files ([#194](https://github.com/ColumbusLabs/DebtLens/issues/194)).
- **SwiftUI** — oversized views and state sprawl (planned framework pack).
- Language packs reuse baselines, `--changed`, reporters, and CI; only AST parsing and detectors are language-specific.
- Documented process for proposing and shipping a new language pack.

## v1.0 — Stable maintainer tool

- Stable JSON output contract.
- Low false-positive defaults.
- SARIF, Markdown, JSON, terminal reporters.
- Baseline support.
- Documented plugin API.
- Public rule contribution process.
