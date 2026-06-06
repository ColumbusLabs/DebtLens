# DebtLens

[![CI](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml/badge.svg)](https://github.com/ColumbusLabs/debtlens/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/debtlens.svg)](https://www.npmjs.com/package/debtlens)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

DebtLens is a static-analysis CLI for finding maintainability debt common in fast-moving AI-assisted TypeScript, React, React Native, Expo, and Next.js codebases.

It is not an "AI code detector." It does not try to prove who wrote a line of code. Instead, it finds the patterns that tend to slip into codebases when teams move quickly with coding assistants: duplicated logic, bloated components, state sprawl, overloaded effects, thin abstractions, prop drilling, TODO debt, and naming drift.

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

See [`docs/showcase-expensify-app.md`](./docs/showcase-expensify-app.md) for a curated run against a large production React Native codebase.

## Why this matters

AI coding assistants make it easier to generate working code quickly. That creates a new maintainer problem: code review must catch duplicated implementations, architectural drift, unnecessary abstractions, and components that quietly absorb too many responsibilities.

That review burden is especially hard for new coders who have not yet built the instinct for what maintainability debt looks like. A beginner can ship something that works and still miss warning signs: repeated logic, overloaded effects, local state scattered everywhere, thin wrappers, or names that drift across a feature.

DebtLens gives maintainers and newer contributors a neutral, explainable report before debt becomes permanent. It is meant to teach what to look for, not just fail a build.

## Current rule set

| Rule | What it catches | Default severity |
| --- | --- | --- |
| `large-component` | React-style components with too many lines, hooks, or branch points | Medium |
| `state-sprawl` | Components/hooks with many local stateful hooks | Medium |
| `effect-complexity` | Long or overloaded `useEffect` blocks | Medium |
| `duplicate-logic` | Near-duplicate functions/components using normalized AST/text similarity | Medium |
| `dead-abstraction` | Thin wrappers that add little behavior | Low |
| `prop-drilling` | Components that forward many props to children | Medium |
| `todo-comment` | TODO/FIXME/HACK/temporary implementation comments | Low |
| `naming-drift` | Files with multiple competing names for the same domain concept | Info |

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
debtlens scan [target]
```

Options:

```txt
-i, --include <patterns>       comma-separated glob patterns to include
-x, --exclude <patterns>       comma-separated glob patterns to exclude
--min-severity <severity>      info, low, medium, or high
--rules <rules>                comma-separated rule ids
--threshold <thresholds>       comma-separated key=value threshold overrides
--max-files <count>            maximum files to scan
--format <format>              terminal, json, markdown, or sarif
-o, --output <path>            write the report to a file
--fail-on <severity>           exit 1 when an issue meets this severity
--baseline <path>              report only issues absent from this baseline file
--write-baseline [path]        write current issues to a baseline file and exit
--changed [ref]                scan only files changed vs HEAD (or vs <ref> if given)
--config <path>                path to debtlens.config.json
--cwd <path>                   working directory
--no-color                     disable terminal color
-q, --quiet                    terminal only: suppress per-finding detail
```

Examples:

```bash
# Scan the current project
debtlens scan

# Scan only app source files
debtlens scan . --include "app/**/*.{ts,tsx},src/**/*.{ts,tsx}"

# Create a Markdown report for a pull request artifact
debtlens scan --format markdown --output debtlens-report.md

# CI gate: allow low/medium debt but fail high-confidence high-severity debt
debtlens scan --min-severity medium --fail-on high

# Tune component-size threshold
debtlens scan --threshold "large-component.maxLines=320,state-sprawl.maxStatefulHooks=8"

# Adopt on a legacy repo: record existing debt, then only report newly introduced debt
debtlens scan --write-baseline
debtlens scan --baseline debtlens-baseline.json --fail-on high

# Pull-request scan: only the files this branch changed vs main
debtlens scan --changed origin/main --fail-on high

# Quiet terminal output: hide per-finding detail
debtlens scan --quiet
```

Baseline fingerprints are stable across line shifts, so moving existing code up or down does not resurface already-recorded debt — only genuinely new issues are reported.

When a scan reads zero files, DebtLens prints a stderr warning with likely causes such as include/exclude globs, the target path, `--cwd`, or an empty `--changed` file set. The warning is advisory and does not change the exit code for `--fail-on`.

## Configuration

Create `debtlens.config.json`:

```json
{
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["node_modules/**", "dist/**", "build/**", ".next/**"],
  "minSeverity": "low",
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

Terminal output is designed for local development. JSON is designed for integrations. Markdown is designed for PR comments, release notes, and maintainer handoffs. SARIF (2.1.0) is designed for GitHub code scanning and other security/quality dashboards.

```bash
debtlens scan --format json
debtlens scan --format markdown --output reports/debtlens.md
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

Inputs: `target`, `min-severity`, `rules`, `fail-on`, `format`, `output`, `changed`, `baseline`, `config`, `write-baseline`, `thresholds`, `max-files`, `working-directory`, `quiet`. Each maps to the matching `scan` flag. `write-baseline` and `baseline` are mutually exclusive. With `fail-on`, a qualifying issue fails the job (gating the merge); `if: always()` still uploads the SARIF so annotations appear even on a failing run.

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

DebtLens is currently a v0.1 proof-of-concept. The architecture is intentionally simple so maintainers can add rules quickly. The next milestones are documented in [`ROADMAP.md`](./ROADMAP.md), and starter contribution ideas are tracked in [`docs/good-first-issues.md`](./docs/good-first-issues.md).

## License

MIT
