# DebtLens

[![CI](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml/badge.svg)](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/debtlens.svg)](https://www.npmjs.com/package/debtlens)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**DebtLens is a maintainability scanner for TypeScript and JavaScript codebases.** The first
supported rule pack targets React (including React Native, Expo, and Next.js apps), but the
core idea applies broadly: catch duplicated logic, bloated modules, weak boundaries, TODO
debt, and naming drift before it becomes permanent.

It is not an "AI code detector." It does not try to prove who wrote a line of code. Instead, it finds the patterns that tend to slip into codebases when teams move quickly with coding assistants — duplicated logic, bloated components, state sprawl, overloaded effects, thin abstractions, prop drilling, TODO debt, and naming drift.

See [`docs/rule-packs.md`](./docs/rule-packs.md) for how **core rules**, **framework packs**, and **language-agnostic reporting** fit together.

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

See [`docs/showcase-expensify-app.md`](./docs/showcase-expensify-app.md) for a curated run against a large production React Native codebase — one supported target, not the sole identity of the tool.

## Why this matters

AI coding assistants make it easier to generate working code quickly. That creates a new maintainer problem: code review must catch duplicated implementations, architectural drift, unnecessary abstractions, and components that quietly absorb too many responsibilities.

That review burden is especially hard for new coders who have not yet built the instinct for what maintainability debt looks like. A beginner can ship something that works and still miss warning signs: repeated logic, overloaded effects, local state scattered everywhere, thin wrappers, or names that drift across a feature.

DebtLens gives maintainers and newer contributors a neutral, explainable report before debt becomes permanent. It is meant to teach what to look for, not just fail a build.

## Current rule set

Built-in rules are grouped into a **core** pack (any TS/JS project) and a **react** pack
(components and hooks). Full taxonomy: [`docs/rule-packs.md`](./docs/rule-packs.md).

| Rule | Pack | What it catches | Default severity |
| --- | --- | --- | --- |
| `duplicate-logic` | core | Near-duplicate functions/components using normalized AST/text similarity | Medium |
| `dead-abstraction` | core | Thin wrappers that add little behavior | Low |
| `todo-comment` | core | TODO/FIXME/HACK/temporary implementation comments | Low |
| `naming-drift` | core | Files with multiple competing names for the same domain concept | Info |
| `large-component` | react | React-style components with too many lines, hooks, or branch points | Medium |
| `state-sprawl` | react | Components/hooks with many local stateful hooks | Medium |
| `effect-complexity` | react | Long or overloaded React effect hooks | Medium |
| `prop-drilling` | react | Components that forward many props to children | Medium |

## Performance benchmarks

Synthetic fixtures under `tests/benchmarks/fixtures/` exercise small (5 files), medium (30), and large (100) scan sizes.

```bash
npm run build
npm run benchmark        # all fixtures + local budget check
npm run benchmark:ci     # small fixture only (used in CI)
```

Local budgets (generous; CI enforces small `< 5000ms` only):

| Fixture | Files | Budget |
| --- | ---: | ---: |
| small | 5 | 5s |
| medium | 30 | 30s |
| large | 100 | 120s |

Per-rule timing is available via `--profile` in [PR #62](https://github.com/ColumbusLabs/DebtLens/pull/62) once merged.

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
debtlens packs            # list built-in rule pack presets
debtlens doctor           # inspect resolved config and matched files without scanning
debtlens rules            # list built-in rule ids and descriptions
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
--format <format>              terminal, json, markdown, pr-comment, or sarif
-o, --output <path>            write the report to a file
--fail-on <severity>           exit 1 when an issue meets this severity
--fail-on-confidence <0-1>     with --fail-on, require at least this confidence to fail
--baseline <path>              report only issues absent from this baseline file
--diff-base <ref>              report only findings introduced since this git ref
--write-baseline [path]        write current issues to a baseline file and exit
--changed [ref]                scan only files changed vs HEAD (or vs <ref> if given)
--staged                       scan only files staged in git
--respect-gitignore            skip files ignored by git
--config <path>                path to debtlens.config.json
--cwd <path>                   working directory
--no-color                     disable terminal color
-q, --quiet                    terminal only: suppress per-finding detail
--profile                      print per-rule timing to stderr without changing findings
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

# CI gate: allow low/medium debt but fail high-confidence high-severity debt
debtlens scan --min-severity medium --fail-on high --fail-on-confidence 0.8

# Tune component-size threshold
debtlens scan --threshold "large-component.maxLines=320,state-sprawl.maxStatefulHooks=8"

# Adopt on a legacy repo: record existing debt, then only report newly introduced debt
debtlens scan --write-baseline
debtlens scan --baseline debtlens-baseline.json --fail-on high

# Pull-request scan: only the files this branch changed vs main
debtlens scan --changed origin/main --fail-on high

# Pre-commit scan: only files currently staged in git
debtlens scan --staged --fail-on high

# Opt in to .gitignore filtering in addition to DebtLens exclude globs
debtlens scan --respect-gitignore

# Debug config and file matching without running detectors
debtlens doctor --pack core
debtlens doctor --include "src/**/*.ts,src/**/*.tsx" --changed

# List rule ids for config, CI, or --rules
debtlens rules
debtlens rules --format json

# Quiet terminal output: hide per-finding detail
debtlens scan --quiet
```

Baseline fingerprints are stable across line shifts, so moving existing code up or down does not resurface already-recorded debt — only genuinely new issues are reported.

When a scan reads zero files, DebtLens prints a stderr warning with likely causes such as include/exclude globs, the target path, `--cwd`, or an empty git file set from `--changed` / `--staged`. The warning is advisory and does not change the exit code for `--fail-on`.

When `duplicate-logic` reaches `duplicate-logic.maxSnippets`, DebtLens warns that duplicate comparisons were capped. JSON output includes the same advisory under `summary.warnings`.

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

Built-in presets select a rule set without hand-picking every rule id. See [`docs/rule-packs.md`](./docs/rule-packs.md).

| Pack | Rules |
| --- | --- |
| `core` | duplicate-logic, dead-abstraction, todo-comment, naming-drift |
| `react` | core + large-component, state-sprawl, effect-complexity, prop-drilling |
| `react-native` | same as `react` |
| `next` | same as `react` |

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pack": "core",
  "include": ["src/**/*.{ts,tsx,js,jsx}"]
}
```

Explicit `rules` in config override the pack. Use `debtlens packs` to list presets.

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

## Output formats

Terminal output is designed for local development. JSON is designed for integrations. Markdown is designed for release notes and maintainer handoffs. `pr-comment` is compact Markdown grouped by file for GitHub pull request comments. SARIF (2.1.0) is designed for GitHub code scanning and other security/quality dashboards.

```bash
debtlens scan --format json
debtlens scan --format markdown --output reports/debtlens.md
debtlens scan --format pr-comment --output debtlens-pr-comment.md
debtlens scan --format sarif --output debtlens.sarif
```

## GitHub Action

Run DebtLens on pull requests and surface findings as code-scanning annotations:

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
      - uses: ColumbusLabs/debtlens@v0
        with:
          changed: origin/${{ github.base_ref }}
          format: sarif
          output: debtlens.sarif
          thresholds: large-component.maxLines=300
          quiet: true
          fail-on: high
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: debtlens.sarif
```

Inputs: `target`, `min-severity`, `rules`, `fail-on`, `format`, `output`, `changed`, `respect-gitignore`, `baseline`, `config`, `write-baseline`, `thresholds`, `max-files`, `working-directory`, `quiet`, `step-summary`, `comment`. Each maps to the matching `scan` flag. `write-baseline` and `baseline` are mutually exclusive. With `fail-on`, a qualifying issue fails the job (gating the merge); `if: always()` still uploads the SARIF so annotations appear even on a failing run.

Set `step-summary: true` to append a compact Markdown rollup to the job's GitHub Actions step summary (useful alongside SARIF or terminal output):

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    format: sarif
    output: debtlens.sarif
    step-summary: true
    quiet: true
    fail-on: high
```

Set `comment: true` to upsert a stable pull request comment (requires `pull-requests: write`):

```yaml
permissions:
  contents: read
  pull-requests: write

- uses: ColumbusLabs/debtlens@v0
  with:
    changed: origin/${{ github.base_ref }}
    comment: true
    fail-on: high
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
[rule pack taxonomy](./docs/rule-packs.md), the
[good first issues list](./docs/good-first-issues.md), and the
[contributor roadmap](https://github.com/ColumbusLabs/DebtLens/projects). Use
[Discussions](https://github.com/ColumbusLabs/DebtLens/discussions) for open-ended
ideas, rule proposals, and usage questions.

Contribution paths: **core TS/JS rules**, **React pack rules**, **framework packs**
(Next.js, RN, Node), **scanner/CI** (baselines, monorepos), and **reporters**.

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

DebtLens is currently in the v0.2 release line. The architecture is intentionally simple:
a language-agnostic scan and reporting layer, with pluggable rule packs on top. React is
the first serious pack; React Native, Next.js, and broader TS/JS rules expand from there.
See [`ROADMAP.md`](./ROADMAP.md) and [`docs/rule-packs.md`](./docs/rule-packs.md).

## License

MIT
