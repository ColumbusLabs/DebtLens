# GitHub Actions

Use the composite Action when you want one canonical JSON scan plus rendered SARIF,
annotations, comments, artifacts, or summaries. The `gate` input accepts
`advisory`, `new-code`, `strict-new-code`, and `legacy-baseline`.

## Advisory first run

Start with a non-blocking report while tuning rules and reviewing signal quality:

```yaml
name: DebtLens
on: pull_request

permissions:
  contents: read

jobs:
  debtlens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ColumbusLabs/debtlens@v0
        with:
          gate: advisory
          format: markdown
          output: debtlens-report.md
          step-summary: true
          upload-json-artifact: true
```

## New-code gate

After the advisory run is stable, gate only findings introduced by the pull request.
Override the preset's default `origin/main` diff base when the target branch varies:

```yaml
name: DebtLens
on: pull_request

permissions:
  contents: read
  security-events: write

jobs:
  debtlens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ColumbusLabs/debtlens@v0
        with:
          gate: new-code
          diff-base: origin/${{ github.base_ref }}
          format: sarif
          output: debtlens.sarif
          sarif-category: debtlens-pr
          step-summary: true
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: debtlens.sarif
```

## Legacy baseline gate

For mature repositories, create the baseline outside the pull request gate, review it,
and commit it:

```bash
npx debtlens scan . --write-baseline debtlens-baseline.json
```

Then gate only findings outside that committed snapshot:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    gate: legacy-baseline
    baseline: debtlens-baseline.json
    step-summary: true
    upload-json-artifact: true
```

The Action intentionally does not pass `gate` to `write-baseline` mode. Baseline creation
stays a snapshot operation, while normal scans apply the selected gate preset.

## Strict new-code migration

Clean or near-clean repositories usually move from `advisory` to `new-code`, then to
`strict-new-code` after false positives are tuned and owners agree to block medium+
new findings:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    gate: strict-new-code
    diff-base: origin/${{ github.base_ref }}
    step-summary: true
```

Legacy repositories usually run `legacy-baseline` while paying down historical findings,
then add `strict-new-code` to pull request CI so newly touched code stays cleaner than
the baseline:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    gate: strict-new-code
    diff-base: origin/${{ github.base_ref }}
    comment: true
    comment-delta-only: true
    step-summary: true
```
