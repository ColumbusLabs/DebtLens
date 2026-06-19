# DebtLens

[![CI](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml/badge.svg)](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/debtlens.svg)](https://www.npmjs.com/package/debtlens)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**DebtLens is a maintainability scanner for TypeScript, JavaScript, Python, Vue/Svelte SFC scripts, Kotlin, and Jetpack Compose codebases.**
The first supported rule packs target React (including React Native, Expo, and Next.js apps)
plus core Python, Vue/Svelte SFC scripts, Kotlin, and Jetpack Compose modules, but the core idea applies broadly: catch duplicated logic, bloated
modules, weak boundaries, TODO debt, and naming drift before it becomes permanent.

It is not an "AI code detector." It does not try to prove who wrote a line of code. Instead, it finds the patterns that tend to slip into codebases when teams move quickly with coding assistants — duplicated logic, bloated components, state sprawl, overloaded effects, thin abstractions, prop drilling, TODO debt, and naming drift.

See [`docs/rule-packs.md`](./docs/rule-packs.md) for how **core rules**, **framework packs**, and **language-agnostic reporting** fit together.
Start with the [`five-minute quickstart`](./docs/quickstart.md), then use the
[`pack chooser`](./docs/pack-chooser.md), [`example scenarios`](./docs/examples.md),
[`report gallery`](./docs/report-gallery.md), and
[`false-positive calibration guide`](./docs/false-positives.md) when you move from a
local scan to CI.
If you are adopting DebtLens broadly, read [`docs/when-not-to-use.md`](./docs/when-not-to-use.md) first so it gates the right work.
For Python, SFC, Kotlin, and multi-language pack work, see the parser notes in [`docs/language-pack-rfc.md`](./docs/language-pack-rfc.md).

## Migration

The **[Unreleased]** section of [`CHANGELOG.md`](./CHANGELOG.md) tracks breaking and
behavioral changes landing on `main` before the next semver tag. Notable recent items:
MCP scan/doctor run in-process (no subprocess spawn), expanded MCP workflow tools for
adoption, compare, suppression, and baseline diff/prune, package config arrays union-merge with
the repo root, atomic scan-cache writes, and stricter ESLint migration validation in
`debtlens init --from-eslint`. Review that section when upgrading from an earlier dev
build or pinned Action tag.

```bash
npx debtlens scan
npx debtlens scan src --format markdown
npx debtlens scan --min-severity medium --fail-on high
npx debtlens scan --rules duplicates,state,effects
```

## Example output

```text
$ debtlens scan examples/react --min-severity medium

DebtLens Report
Scanned 3 files with 8 rules in 38ms.
Issues: 4 | high 2 | medium 2 | low 0 | info 0

HIGH (2)
  Prop drilling [prop-drilling]
  src/Dashboard.tsx:13
  Dashboard forwards 7 props across 3 child components.
  confidence 73%
  - ReleaseHero: movie, userId, region, theme, onSelect, onSave
  - ReleaseGrid: movie, userId, region, theme, onSelect, onSave, onShare
  suggestion: Consider colocating the data owner closer to consumers, using a
  composition slot, or extracting a focused context for stable cross-cutting values.

  Duplicate logic [duplicate-logic]
  src/duplicateOne.ts:1
  normalizeMovieRelease is 100% structurally similar to normalizeGameRelease.
  confidence 100%
  - src/duplicateOne.ts:1-18 (18 lines)
  - src/duplicateTwo.ts:1-18 (18 lines)
```

See [`docs/showcase-expensify-app.md`](./docs/showcase-expensify-app.md) for a curated run against a large production React Native codebase and [`docs/showcase-next-app.md`](./docs/showcase-next-app.md) for a reproducible Next.js App Router showcase template.

## Why this matters

AI coding assistants make it easier to generate working code quickly. That creates a new maintainer problem: code review must catch duplicated implementations, architectural drift, unnecessary abstractions, and components that quietly absorb too many responsibilities.

That review burden is especially hard for new coders who have not yet built the instinct for what maintainability debt looks like. A beginner can ship something that works and still miss warning signs: repeated logic, overloaded effects, local state scattered everywhere, thin wrappers, or names that drift across a feature.

DebtLens gives maintainers and newer contributors a neutral, explainable report before debt becomes permanent. It is meant to teach what to look for, not just fail a build.

## Current rule set

Built-in rules are grouped into **core** TS/JS, **react**, framework, maintainer, and
language packs. Full taxonomy: [`docs/rule-packs.md`](./docs/rule-packs.md).

| Rule | Pack | What it catches | Default severity |
| --- | --- | --- | --- |
| `duplicate-logic` | core | Near-duplicate functions/components using normalized AST/text similarity | Medium |
| `test-duplication` | core | Structurally identical test cases across test files | Medium |
| `import-cycle` | core | Circular relative import graphs | Medium |
| `complex-control-flow` | core | Branch-heavy or deeply nested functions | Medium |
| `config-drift` | core | Conflicting repeated values across JSON config files | Medium |
| `dead-abstraction` | core | Thin wrappers that add little behavior | Low |
| `todo-comment` | core | TODO/FIXME/HACK/temporary implementation comments | Low |
| `naming-drift` | core | Files with multiple competing names for the same domain concept | Info |
| `large-component` | react | React-style components with too many lines, hooks, or branch points | Medium |
| `state-sprawl` | react | Components/hooks with many local stateful hooks | Medium |
| `effect-complexity` | react | Long or overloaded React effect hooks | Medium |
| `prop-drilling` | react | Components that forward many props to children | Medium |
| `rn-host-forwarding` | react-native | RN wrappers forwarding many props into host primitives | Medium |
| `server-client-boundary` | next | App Router server/client boundary mistakes | High |
| `route-handler-size` | next | Oversized Next route/page modules | Medium |
| `data-loader-sprawl` | next | Server loaders/components with many fetches or awaits | Medium |
| `handler-depth` | node | Deeply nested Express/Fastify handlers | Medium |
| `route-sprawl` | node | Route modules registering too many endpoints | Medium |
| `python-duplicate-logic` | python | Near-duplicate Python functions | Medium |
| `python-large-function` | python | Oversized or branch-heavy Python functions | Medium |
| `python-complex-control-flow` | python | Branch-heavy or deeply nested Python functions | Medium |
| `python-dead-abstraction` | python | Thin Python pass-through functions | Low |
| `python-todo-comment` | python | TODO/FIXME/HACK comments in Python files | Low |
| `python-route-sprawl` | python-web | Flask/Blueprint or Django URL modules registering too many routes | Medium |
| `vue-todo-comment` | vue | TODO/FIXME/HACK comments inside Vue script blocks | Low |
| `vue-large-script` | vue | Oversized Vue SFC scripts or script functions | Medium |
| `vue-duplicate-logic` | vue | Near-duplicate Vue script functions | Medium |
| `svelte-todo-comment` | svelte | TODO/FIXME/HACK comments inside Svelte script blocks | Low |
| `svelte-large-script` | svelte | Oversized Svelte component scripts or script functions | Medium |
| `svelte-duplicate-logic` | svelte | Near-duplicate Svelte script functions | Medium |
| `kotlin-duplicate-logic` | kotlin | Near-duplicate Kotlin functions | Medium |
| `kotlin-large-function` | kotlin | Oversized or branch-heavy Kotlin functions | Medium |
| `kotlin-dead-abstraction` | kotlin | Thin Kotlin pass-through functions | Low |
| `kotlin-todo-comment` | kotlin | TODO/FIXME/HACK comments in Kotlin files | Low |
| `compose-large-composable` | compose | Oversized or branch-heavy Jetpack Compose functions | Medium |
| `compose-state-hoisting` | compose | Composables owning too many local state holders | Medium |

## Performance benchmarks

Synthetic fixtures under `tests/benchmarks/fixtures/` exercise small (5 files), medium (30), and large (100) scan sizes.

```bash
npm run build
npm run benchmark        # all fixtures + local budget check
npm run benchmark:ci     # small fixture only (used in CI)
npm run benchmark -- --budget small=7500
```

Default budgets are generous local regression caps. Override them in CI with
`DEBTLENS_BENCHMARK_BUDGETS=small=5000` or repeated `--budget fixture=ms`
arguments instead of editing the script for each runner class. `benchmark:ci`
wraps `--small-only`, which keeps pull-request checks fast on huge repos while
still failing when the small fixture exceeds the configured cap.

| Fixture | Files | Budget |
| --- | ---: | ---: |
| small | 5 | 5s |
| medium | 30 | 30s |
| large | 100 | 120s |

Examples:

```bash
DEBTLENS_BENCHMARK_BUDGETS=small=5000 npm run benchmark:ci
DEBTLENS_BENCHMARK_BUDGET_SMALL_MS=7500 npm run benchmark:ci
npm run benchmark -- --budget small=7500 --budget medium=45000
```

Per-rule timing is available with `--profile`; CI can keep the raw timings in the canonical JSON report artifact. For large repeat scans, `--cache` writes a content-hash cache at `.debtlens/cache.json` by default and returns cached results when the selected files and scan options are unchanged. Use `--batch-size <count>` to yield between source-loading batches, and `--parallel` to dispatch independent detectors concurrently while preserving deterministic output ordering.

## Install

```bash
npm install --save-dev debtlens
```

or run without installing:

```bash
npx debtlens scan
```

## Usage

```bash
debtlens init             # write a starter debtlens.config.json (use --force to overwrite)
debtlens init --pack core # starter config using the core rule pack preset
debtlens init --policy @org/debtlens-policy # starter config from a shared policy package
debtlens init --from-eslint eslint.config.json # print a migration suggestion without writing
debtlens adopt            # adoption report (dry run; recommends minSeverity)
debtlens watch examples/react --rules todo-comment # rescan on file changes
debtlens completions zsh  # print shell completions
debtlens mcp              # stdio MCP server for Cursor/Claude-style agents
debtlens packs            # list built-in rule pack presets
debtlens doctor           # inspect resolved config and matched files without scanning
debtlens rules            # list built-in rule ids and descriptions
debtlens explain <rule>   # print rule docs, default thresholds, and false-positive guidance
debtlens suppress --rule <rule> --reason "<why>"   # print a copy-paste inline suppression comment
debtlens baseline diff . --baseline debtlens-baseline.json    # preview baseline drift without writing
debtlens baseline prune . --baseline debtlens-baseline.json   # remove resolved entries from a baseline
debtlens baseline update . --baseline debtlens-baseline.json  # rewrite a baseline from the current scan
debtlens compare previous.json current.json --format terminal # compare two ScanResult JSON reports
debtlens scan [target]
```

Options:

```txt
-i, --include <patterns>       comma-separated glob patterns to include
-x, --exclude <patterns>       comma-separated glob patterns to exclude
--min-severity <severity>      info, low, medium, or high
--pack <pack>                  built-in rule pack preset
--rules <rules>                comma-separated rule ids
--threshold <thresholds>       comma-separated key=value threshold overrides
--max-files <count>            maximum files to scan
--format <format>              terminal, json, markdown, pr-comment, sarif, html, or junit
-o, --output <path>            write the report to a file
--fail-on <severity>           exit 1 when an issue meets this severity
--fail-on-confidence <0-1>     with --fail-on, require at least this confidence to fail
--fail-on-regression           exit 1 when issue counts increase vs --baseline or --diff-base
--baseline <path>              report only issues absent from this baseline file
--diff-base <ref>              report only findings introduced since this git ref
--write-baseline [path]        write current issues to a baseline file and exit
--changed [ref]                scan only files changed vs HEAD (or vs <ref> if given)
--staged                       scan only files staged in git
--respect-gitignore            skip files ignored by git
--config <path>                path to debtlens.config.json
--cwd <path>                   working directory
--package <name>               scan a single npm/pnpm/Nx workspace package
--no-color                     disable terminal color
-q, --quiet                    terminal only: suppress per-finding detail
--profile                      print per-rule timing to stderr without changing findings
--cache [path]                 reuse unchanged scan results from a content-hash cache
--parallel                     run detectors concurrently after source loading
--batch-size <count>           load source files in bounded batches
--blame-age                    add introducedDaysAgo metadata to JSON issues via git blame
--audit-suppressions           include used and unused inline suppression directives
--group-by <group>             terminal grouping: severity, rule, or file
--sarif-compact                SARIF only: emit only rules referenced by findings
--markdown-heatmap [limit]     Markdown only: append a debt heatmap table
--pr-comment-max-findings <count>  PR comment only: cap detailed findings
--pr-comment-max-bytes <count>     PR comment only: cap rendered body bytes
--pr-comment-full-report-url <url> PR comment only: link omitted findings to a full report
```

Examples:

```bash
# Scan the current project
debtlens scan

# Scan only app source files
debtlens scan . --include "app/**/*.ts,app/**/*.tsx,src/**/*.ts,src/**/*.tsx"

# Create a Markdown report for a pull request artifact
debtlens scan --format markdown --output debtlens-report.md

# Create a compact grouped PR comment body
debtlens scan --format pr-comment --output debtlens-pr-comment.md

# Keep a busy PR comment compact while linking to the full report
debtlens scan --format pr-comment --pr-comment-max-findings 20 --pr-comment-max-bytes 60000 --pr-comment-full-report-url "$DEBTLENS_REPORT_URL" --output debtlens-pr-comment.md

# Create HTML and JUnit reports for CI artifacts
debtlens scan --format html --output reports/debtlens.html
debtlens scan --format junit --output reports/debtlens.junit.xml

# Package-scoped adoption report in a workspace
debtlens adopt . --package web --format markdown

# CI gate: allow low/medium debt but fail high-confidence high-severity debt
debtlens scan --min-severity medium --fail-on high --fail-on-confidence 0.8

# Tune component-size threshold
debtlens scan --threshold "large-component.maxLines=320,state-sprawl.maxStatefulHooks=8"

# Adopt on a legacy repo: record existing debt, then only report newly introduced debt
debtlens scan --write-baseline
debtlens scan --baseline debtlens-baseline.json --fail-on high
debtlens scan --baseline debtlens-baseline.json --fail-on-regression

# Maintain that baseline as debt is fixed
debtlens baseline diff . --baseline debtlens-baseline.json
debtlens baseline prune . --baseline debtlens-baseline.json --dry-run
debtlens baseline prune . --baseline debtlens-baseline.json
debtlens baseline update . --baseline debtlens-baseline.json

# Pull-request scan: only the files this branch changed vs main
debtlens scan --changed origin/main --fail-on high

# Pre-commit scan: only files currently staged in git
debtlens scan --staged --fail-on high

# Opt in to .gitignore filtering in addition to DebtLens exclude globs
debtlens scan --respect-gitignore

# Debug config and file matching without running detectors
debtlens doctor --pack core
debtlens doctor --include "src/**/*.ts,src/**/*.tsx" --changed
debtlens doctor --provenance --threshold "large-component.maxLines=320"

# Local iteration: run once, then rescan after file changes until Ctrl+C
debtlens watch examples/react --rules todo-comment --debounce 300

# List rule ids for config, CI, or --rules
debtlens rules
debtlens rules --format json

# Quiet terminal output: hide per-finding detail
debtlens scan --quiet
```

## Recommended adoption path

Preview findings and get a numbered rollout plan before committing config or baseline files. The plan includes a recommended first pack, baseline/new-code gate commands, package scope when applicable, and changed/staged local workflows:

```bash
debtlens adopt --cwd . --rules todo-comment   # dry-run report (default)
debtlens adopt --write-config --write-baseline --force
```

The second command writes `debtlens.config.json` and `debtlens-baseline.json` (baseline write is skipped when zero issues are found). For established repositories, follow the generated plan's baseline or `--diff-base` CI commands so pull requests focus on newly introduced debt; add `--fail-on-regression` when you want count increases to fail as well.

Baseline fingerprints are stable across line shifts, so moving existing code up or down does not resurface already-recorded debt — only genuinely new issues are reported. The JSON reporter exposes the same line-stable value as both `id` and `fingerprint` in ScanResult schema v1.

Use `debtlens baseline diff` to review new, resolved, and changed findings against an existing baseline. `diff` and `--dry-run` are read-only and do not write files. `debtlens baseline prune` removes entries that no longer appear in the current scan, while `debtlens baseline update` rewrites the baseline to the current scan result. Legacy baselines without newer summary metadata are supported. Run maintenance with the same scan scope and options used to create the original baseline, including target, `--cwd`, `--package`, `--include`, `--exclude`, `--pack`, `--rules`, and `--threshold`, so DebtLens compares the same surface instead of treating scope changes as resolved or new debt.

For safety, mutating `baseline prune` refuses explicitly scoped scans such as `--rules`, `--package`, custom include/exclude globs, non-default targets, max-file caps, or config-driven scan shaping. Use `baseline diff` to inspect scoped drift, or `baseline update` when you intentionally want to rewrite a scoped baseline.

When a scan reads zero files, DebtLens prints a stderr warning with likely causes such as include/exclude globs, the target path, `--cwd`, or an empty git file set from `--changed` / `--staged`. The warning is advisory and does not change the exit code for `--fail-on`.

When `duplicate-logic` reaches `duplicate-logic.maxSnippets`, DebtLens warns that duplicate comparisons were capped. JSON output includes the same advisory under `summary.warnings`.

## JSON contract

`debtlens scan --format json` emits `schemaVersion: 1`. The stable JSON Schema URL is `https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.scan-result.schema.json`.

Every reported issue includes a line-stable `fingerprint`. Inline suppressions with reasons are exported at the root `suppressions` array so compliance and CI consumers can audit what was hidden. Pass `--audit-suppressions` to also export `suppressionDirectives`, a directive-level audit of used, unused, and not-evaluated inline suppressions with file, line, rule, reason, hidden-finding count, and recommended action. When a baseline or `--diff-base` is used, `summary.deltaFromBaseline` reports new, resolved, changed, total, and per-rule count deltas. JSON and Markdown reports also surface `summary.correlations` for files where multiple rules cluster together.

Use `debtlens compare previous.json current.json --format terminal|markdown|json` to compare two ScanResult JSON files without rescanning. The compare report includes total, severity, and rule deltas; when both inputs contain issue arrays, it also reports exact new, resolved, changed, severity-regression, and top-new-file counts. Run compare with the same scan scope and options for meaningful trends.

Pass `--blame-age` to enrich JSON issues with optional `introducedDaysAgo` metadata from
`git blame`. This is best-effort: outside git repositories, uncommitted lines, and staged
blob scans omit the field without changing detector output or exit codes.

## Inline suppressions

Suppress intentional findings in source with an explicit, auditable reason. Suppressions apply during the scan; baseline and `--diff-base` filtering run afterward on the remaining issues.

**Next-line** — hides a finding on the line immediately below the comment:

```ts
// debtlens-disable-next-line todo-comment -- tracked in PROJ-123
// TODO: remove after migration ships
```

**File-level** — hides all findings for that rule in the file:

```ts
// debtlens-disable-file naming-drift -- domain vocabulary is intentional here
```

Rules:

- A non-empty reason is required after `--`. Suppressions without a reason are ignored and emit a warning.
- Unknown rule ids emit a warning and do not suppress.
- Only the matching rule (and line, for next-line) is suppressed; other rules on the same line still report.

Terminal output includes inline suppression counts in the filter stats line (for example, `1 inline suppressed`). JSON reports expose the same count under `summary.filterStats.suppressedByInline`.

Use `--audit-suppressions` to find stale or broad directives:

```bash
debtlens scan . --audit-suppressions --format markdown
debtlens scan . --audit-suppressions --format json
```

Audit output separates file-wide and next-line suppressions, marks directives as `used`, `unused`, or `not-evaluated`, and recommends whether to remove stale suppressions, narrow broad file-wide exceptions, or rerun the audit with the relevant rule enabled.

`debtlens suppress` prints a ready-to-paste directive so you don't have to remember the syntax:

```bash
debtlens suppress --rule todo-comment --reason "tracked in PROJ-123"
# // debtlens-disable-next-line todo-comment -- tracked in PROJ-123

debtlens suppress --rule naming-drift --reason "domain vocabulary is intentional" --file
# // debtlens-disable-file naming-drift -- domain vocabulary is intentional
```

Prefer baselines for legacy debt, config tuning for false positives, and inline suppressions for rare, documented exceptions. See [`docs/rules.md`](./docs/rules.md#suppressing-findings) for guidance.

## Configuration

Create `debtlens.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["node_modules/**", "dist/**", "build/**", ".next/**"],
  "minSeverity": "low",
  "respectGitignore": false,
  "rules": [
    "large-component",
    "state-sprawl",
    "effect-complexity",
    "duplicate-logic",
    "dead-abstraction",
    "prop-drilling",
    "todo-comment",
    "naming-drift"
  ],
  "thresholds": {
    "large-component.maxLines": 250,
    "state-sprawl.maxStatefulHooks": 6,
    "effect-complexity.maxLines": 30,
    "duplicate-logic.minSimilarity": 0.86
  },
  "propDrilling": {
    "ignoreComponents": ["DesignSystemCard", "DesignSystemModal"]
  }
}
```

The stable JSON Schema URL is `https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json`. `debtlens init` writes this URL into new config files so editors can provide validation and autocomplete.

### Rule packs

Built-in presets select a rule set without hand-picking every rule id. Language packs
also declare their discovery metadata, so selecting `python`, `vue`, `svelte`, `kotlin`, or `compose`
adds the registered source globs without one-off CLI flags. See
[`docs/rule-packs.md`](./docs/rule-packs.md).

| Pack | Rules |
| --- | --- |
| `core` | framework-neutral maintainability rules: duplication, large functions, barrels, test boundaries, API surface, TODOs, naming drift |
| `react` | core + component, hook, provider, prop, and Storybook signals |
| `react-native` | react + RN host primitive forwarding |
| `next` | react + App Router boundary, route size, and data-loader checks |
| `node` | core + Express/Fastify handler depth and route sprawl |
| `python` | Python duplicate functions, large and branch-heavy functions, thin wrappers, and TODO comments |
| `python-web` | python + Flask/Blueprint and Django URL route sprawl |
| `vue` | Vue SFC script TODO, large-script, and duplicate-logic signals |
| `svelte` | Svelte SFC script TODO, large-script, and duplicate-logic signals |
| `kotlin` | Kotlin duplicate functions, large functions, thin wrappers, and TODO comments |
| `compose` | Jetpack Compose oversized composables and local state-hoisting smells |
| `expo` | React Native tuning for Expo Router projects |
| `ai-assisted-maintainer` | high-signal maintainability checks for assistant-heavy codebases; no authorship claims |
| `oss-maintainer` | library API surface, barrels, duplication, tests, and TODO debt |

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pack": "core",
  "include": ["src/**/*.{ts,tsx,js,jsx}"]
}
```

Explicit `rules` in config override the pack. Use `debtlens packs` to list presets.

Use comma-separated packs for mixed-language scans:

```bash
debtlens scan . --pack core,python,vue,svelte,kotlin,compose
```

### Per-rule severities and confidence floors

Tune noisy rules without disabling them. `ruleSeverities` replaces the severity a rule
reports (changing summary counts and `--fail-on` behavior), and `ruleConfidenceFloors`
hides findings from a rule below a minimum confidence:

```json
{
  "ruleSeverities": {
    "naming-drift": "info"
  },
  "ruleConfidenceFloors": {
    "prop-drilling": 0.8
  }
}
```

Unknown rule ids in either map emit a warning with a did-you-mean suggestion. Issues
hidden by a confidence floor are counted under `summary.filterStats.filteredByConfidenceFloor`.
Both maps accept plugin rule ids when plugins are configured.

### Custom naming vocabulary

`naming-drift` ships with a built-in media/release vocabulary. Add your own domain concepts with `vocabulary` (concept id → competing terms). Your groups are merged with the built-ins, and a group with the same id overrides the built-in one.

```json
{
  "vocabulary": {
    "commerce-entity": ["product", "sku", "item", "listing"],
    "auth-user": ["user", "account", "member", "profile"]
  }
}
```

### Plugins

Ship custom rules as local ESM modules without forking the CLI. List them in config with
the plugin API version, then select them like built-in rules:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./debtlens-rules/no-console.mjs"],
  "include": ["src/**/*.{ts,tsx,js,jsx}"]
}
```

Plugin authors import types from the published `debtlens/plugin` entry point:

```ts
import type { Detector, DetectorContext } from "debtlens/plugin";
```

Besides `rules`, a plugin's default export may include `thresholds` (defaults read by
`context.getThreshold`, merged after built-ins so user config and `--threshold` still
override them) and `vocabulary` (naming-drift concept groups, overridden by user config
groups with the same id):

```js
export default {
  rules: [noConsoleDetector],
  thresholds: { "no-console.maxCalls": 0 },
  vocabulary: { logging: ["log", "logger", "console", "debug", "trace"] },
};
```

See the reference plugin in [`examples/plugin/`](./examples/plugin/) and the full
contract in [`docs/plugin-api-rfc.md`](./docs/plugin-api-rfc.md). Plugin paths must stay
within the config file's directory tree, rule ids must not collide with built-ins, and
CI pipelines scanning untrusted repos can set `DEBTLENS_DISABLE_PLUGINS=1` to skip
plugin loading entirely (see [`SECURITY.md`](./SECURITY.md)).

### Policy packages

Shared organization policies can be scaffolded from an npm package, an installed package
module path, or a local policy module:

```bash
debtlens init --policy @org/debtlens-policy
debtlens init --policy ./node_modules/@org/debtlens-policy/rules/index.mjs
debtlens init --policy ./node_modules/@org/debtlens-policy/presets/strict.mjs
debtlens init --policy ./debtlens-policy/index.mjs
debtlens init --policy ./tools/debtlens-policies/strict.mjs
```

The generated config pins `pluginApiVersion` and registers the policy module under
`plugins`. Policy modules are trusted code loaded as plugins, so only enable packages or
local files maintained by your organization. CI pipelines that scan untrusted pull
requests can set `DEBTLENS_DISABLE_PLUGINS=1` to skip policy plugin loading while still
running built-in rules and local non-plugin config. See
[`docs/policy-packages.md`](./docs/policy-packages.md) for the package layout and rollout
guidance.

## Output formats

Terminal output is designed for local development. JSON is designed for integrations. Markdown is designed for release notes and maintainer handoffs. `pr-comment` is compact Markdown with prioritized fix targets, collapsible per-file sections, and optional caps for GitHub pull request comments. SARIF (2.1.0) is designed for GitHub code scanning and other security/quality dashboards. HTML is a self-contained human report; JUnit XML is for CI systems that expect test-style failures.

```bash
debtlens scan --format json
debtlens scan --audit-suppressions --format markdown
debtlens scan --format markdown --markdown-heatmap 10 --output reports/debtlens.md
debtlens scan --format pr-comment --output debtlens-pr-comment.md
debtlens scan --format pr-comment --pr-comment-max-findings 20 --pr-comment-max-bytes 60000 --output debtlens-pr-comment.md
debtlens scan --format sarif --sarif-compact --output debtlens.sarif
debtlens scan --format html --output reports/debtlens.html
debtlens scan --format junit --output reports/debtlens.junit.xml
debtlens scan --group-by rule
debtlens compare previous.json current.json --format terminal
debtlens compare previous.json current.json --format markdown
debtlens compare previous.json current.json --format json
```

## GitHub Action

Run DebtLens on pull requests and surface findings as code-scanning annotations. Pin version tags such as `@v0.3.0` when you want repeatable CI; moving tags such as `@v0` track the latest compatible v0 release. Versioned releases attach a self-contained Action runtime asset so tagged Action runs can skip the source build path; source checkouts build as a fallback when the release asset or `dist/cli/index.js` is missing.

```yaml
name: DebtLens
on: pull_request

permissions:
  contents: read
  security-events: write   # required to upload SARIF

jobs:
  debtlens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # needed for --changed to diff against the base branch
      - uses: ColumbusLabs/debtlens@v0.3.0
        with:
          changed: origin/${{ github.base_ref }}
          format: sarif
          output: debtlens.sarif
          upload-json-artifact: true
          thresholds: large-component.maxLines=300
          quiet: true
          fail-on: high
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: debtlens.sarif
```

Scan/report inputs: `target`, `min-severity`, `rules`, `pack`, `fail-on`, `fail-on-confidence`, `fail-on-regression`, `format`, `output`, `changed`, `diff-base`, `package`, `profile`, `cache`, `cache-path`, `parallel`, `batch-size`, `blame-age`, `audit-suppressions`, `respect-gitignore`, `baseline`, `config`, `write-baseline`, `thresholds`, `max-files`, `working-directory`, `quiet`, `group-by`, `sarif-compact`, `markdown-heatmap`, `step-summary`, `annotations`, `annotations-max-count`, `comment`, `comment-delta-only`, `comment-max-findings`, `comment-max-bytes`, `comment-full-report-url`, and `comment-fail-on-error`. Action-only orchestration inputs: `previous-report`, `json-output`, `upload-json-artifact`, `json-artifact-name`, and `json-artifact-retention-days`. `write-baseline` and `baseline` are mutually exclusive. The Action runs one canonical JSON scan, renders all requested outputs from that ScanResult, can upload the JSON artifact when `upload-json-artifact` is enabled, and then replays the scan exit code so comments/artifacts still appear on gated failures.

Action outputs include `scan-status`, `gate-status`, `total-issues`, `high-issues`, `medium-issues`, `low-issues`, `info-issues`, `top-rule`, `top-rule-count`, `json-path`, `json-artifact-name`, `report-path`, and `report-format`. Give the Action step an `id` to use them in later steps:

```yaml
- id: debtlens
  uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    json-output: debtlens-report.json
    upload-json-artifact: true
- run: echo "DebtLens found ${{ steps.debtlens.outputs.total-issues }} issue(s); gate ${{ steps.debtlens.outputs.gate-status }}"
```

Set `step-summary: true` to append a Markdown rollup to the job's GitHub Actions step summary. The summary includes the gate decision, warnings, filter stats, report/artifact paths, optional trend comparison, suppression audit, and top findings:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    format: sarif
    output: debtlens.sarif
    step-summary: true
    previous-report: previous-debtlens-report.json
    quiet: true
    fail-on: high
```

For pull requests, you can compare the PR scan against the latest successful base-branch artifact. This workflow also runs on `main` so it seeds the artifact PRs compare against; the download step is intentionally soft-fail so first runs and renamed artifacts still produce the current summary:

```yaml
name: DebtLens PR trend
on:
  pull_request:
  push:
    branches: [main]

permissions:
  actions: read
  contents: read

jobs:
  debtlens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Download latest base report
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p previous
          run_id="$(gh run list --workflow "$GITHUB_WORKFLOW" --branch "${{ github.base_ref }}" --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
          if [ -n "$run_id" ]; then
            gh run download "$run_id" --name debtlens-scan-result --dir previous || true
          fi
      - uses: ColumbusLabs/debtlens@v0
        with:
          changed: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }}
          previous-report: ${{ github.event_name == 'pull_request' && 'previous/debtlens-report.json' || '' }}
          json-output: current/debtlens-report.json
          step-summary: true
          upload-json-artifact: true
          quiet: true
```

Set `annotations: true` to emit capped GitHub workflow command annotations without SARIF/code scanning. SARIF is best for code-scanning alert history, workflow annotations are useful for lightweight inline check feedback, and PR comments are best for grouped review context.

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    annotations: true
    annotations-max-count: 50
    fail-on: high
```

The JSON artifact is named `debtlens-scan-result` by default. To also write it into the workspace for a later workflow step:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    json-output: debtlens-report.json
    json-artifact-name: debt-metrics
```

A scheduled debt trend job can restore the last canonical JSON report, produce a fresh one, upload the new artifact, and include the trend in the step summary. If the previous artifact does not exist yet, DebtLens adds a soft warning to the summary and continues:

```yaml
name: DebtLens trend
on:
  schedule:
    - cron: "0 13 * * 1"
  workflow_dispatch:

jobs:
  trend:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Download previous report
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p previous
          run_id="$(gh run list --workflow "$GITHUB_WORKFLOW" --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
          if [ -n "$run_id" ]; then
            gh run download "$run_id" --name debtlens-scan-result --dir previous || true
          fi
      - id: debtlens
        uses: ColumbusLabs/debtlens@v0
        with:
          json-output: current/debtlens-report.json
          previous-report: previous/debtlens-report.json
          step-summary: true
          upload-json-artifact: true
          quiet: true
      - name: Use metric outputs
        run: echo "DebtLens total=${{ steps.debtlens.outputs.total-issues }} top=${{ steps.debtlens.outputs.top-rule }}"
```

A Shields endpoint badge can be generated from the artifact by publishing a tiny JSON file derived from `summary.totalIssues`:

```json
{
  "schemaVersion": 1,
  "label": "DebtLens",
  "message": "12 issues",
  "color": "orange"
}
```

For example:

```bash
jq '{schemaVersion: 1, label: "DebtLens", message: (.summary.totalIssues|tostring + " issues"), color: (if .summary.totalIssues == 0 then "brightgreen" elif .summary.bySeverity.high > 0 then "red" else "orange" end)}' debtlens-report.json > debtlens-badge.json
```

For a stricter "0 new high debt" badge after `--baseline` or `--diff-base`, derive the
message from the remaining high-severity issues in the filtered report:

```bash
jq '{
  schemaVersion: 1,
  label: "DebtLens",
  message: (if [.issues[] | select(.severity == "high")] | length == 0 then "0 new high debt" else (([.issues[] | select(.severity == "high")] | length | tostring) + " new high") end),
  color: (if [.issues[] | select(.severity == "high")] | length == 0 then "brightgreen" else "red" end)
}' debtlens-report.json > debtlens-high-badge.json
```

Publish that JSON file from any static endpoint and use the Shields endpoint badge:

```markdown
![DebtLens](https://img.shields.io/endpoint?url=https://example.com/debtlens-high-badge.json)
```

Other CI templates: [GitLab](./docs/ci-gitlab.md), [Bitbucket](./docs/ci-bitbucket.md), and [Azure Pipelines](./docs/ci-azure.md).

For local hooks, see [pre-commit hooks](./docs/pre-commit.md). For monorepo rollout, see [per-package baselines](./docs/monorepo-baselines.md).
For shared organization policy, see [policy packs as npm packages](./docs/policy-packages.md). For hosted GitHub integration tradeoffs, see the [GitHub App RFC](./docs/github-app-rfc.md).
For agent integrations, see the [MCP server setup](./docs/mcp.md).

Set `comment: true` to upsert a stable pull request comment (requires `pull-requests: write`). Comment posting is warn-only by default so forked or permission-limited pull requests can still produce artifacts and annotations; set `comment-fail-on-error: true` when a missing comment should fail the Action.

```yaml
permissions:
  contents: read
  pull-requests: write

- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    diff-base: origin/${{ github.base_ref }}
    comment: true
    comment-delta-only: true
    comment-max-findings: 20
    comment-max-bytes: 60000
    fail-on: high
```

PR comment source links use the pull request head SHA when the workflow event provides it, falling back to `GITHUB_SHA` for push and other events. Use `comment-full-report-url` when capped comments should point reviewers to the complete Markdown, JSON, or HTML artifact.

For very large monorepos, keep the first Action rollout intentionally narrow.
Diff against the pull request base, limit to the package or changed files you
own, start with the `core` pack or a small rule list, and cap file volume so
new contributors get deterministic feedback before you widen coverage:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    package: web
    rules: todo-comment,duplicate-logic
    max-files: 500
    profile: true
    step-summary: true
```

If that workflow also runs the repository benchmark gate, prefer the small
fixture check so the job does not spend time on synthetic medium/large fixtures:

```yaml
- name: Benchmark regression gate
  run: npm run benchmark:ci
  env:
    DEBTLENS_BENCHMARK_BUDGETS: small=5000
```

To post a grouped PR comment manually instead, write the `pr-comment` output and post it with `actions/github-script`:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
  - uses: ColumbusLabs/debtlens@v0
    with:
      changed: origin/${{ github.base_ref }}
      format: pr-comment
      output: debtlens-pr-comment.md
      fail-on: high
  - uses: actions/github-script@v7
    if: always() && github.event_name == 'pull_request'
    with:
      script: |
        const fs = require('node:fs');
        const body = fs.readFileSync('debtlens-pr-comment.md', 'utf8');
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.issue.number,
          body,
        });
```

## Contributing

Want to help make DebtLens better? Start with the
[first-PR guide](./docs/contributing-first-pr.md), the
[rule pack taxonomy](./docs/rule-packs.md), and
[CONTRIBUTING.md](./CONTRIBUTING.md). Current starter work is tracked in
[`docs/good-first-issues.md`](./docs/good-first-issues.md), which separates active
newcomer tasks from the historical v0.3 roadmap batch. Propose new work in
[Discussions](https://github.com/ColumbusLabs/DebtLens/discussions), via the rule request
template, or the [plugin API](./docs/plugin-api-rfc.md).

Contribution paths: **core TS/JS rules**, **Python rules**, **Kotlin rules**, **React pack rules**,
**framework packs** (Next.js, RN, Node, Compose, Python web), **scanner/CI** (baselines, monorepos, inline
suppressions), **plugins**, and **reporters**. New rule authors should follow the rule checklist in
[CONTRIBUTING.md](./CONTRIBUTING.md#rule-review-bar).

## Development

```bash
npm install
npm run typecheck
npm test          # node:test suite (run via tsx)
npm run test:all  # typecheck + tests
npm run build
npm run dev
node dist/cli/index.js scan examples/react --min-severity info
```

## Project status

DebtLens is in the **v0.3** release line. Recent capabilities include `debtlens adopt`
and `debtlens doctor`, rule packs, inline suppressions with required reasons,
confidence-aware `--fail-on`, monorepo `--package` scanning, GitHub Action step summaries
and PR comment upsert, and `--diff-base` branch comparisons.

The architecture stays intentionally simple: a language-agnostic scan and reporting
layer with pluggable rule packs on top. Current shipped packs cover core TS/JS, React,
React Native, Next.js, Expo, Node, Python, Python web, Vue/Svelte SFC scripts, Kotlin, Jetpack Compose, and maintainer workflows. Additional
packs expand from the same scan/reporting contract. See [`ROADMAP.md`](./ROADMAP.md) and
[`docs/rule-packs.md`](./docs/rule-packs.md).

## License

MIT
