# Report Gallery

DebtLens renders one `ScanResult` into several surfaces. Pick the format based on where
reviewers already work.

| Format | Command | Best use |
| --- | --- | --- |
| Terminal | `debtlens scan examples/react --format terminal` | Local inspection and quick triage. |
| JSON | `debtlens scan examples/react --format json --output debtlens-report.json` | Integrations, dashboards, and trend tooling. |
| Markdown | `debtlens scan examples/react --format markdown --output debtlens-report.md` | PR descriptions, release notes, and maintainer handoffs. |
| PR comment | `debtlens scan examples/react --format pr-comment --output debtlens-pr-comment.md` | Compact GitHub review comments with prioritized fix targets and optional caps. |
| SARIF | `debtlens scan examples/react --format sarif --output debtlens.sarif` | GitHub code scanning and compatible quality dashboards. |
| HTML | `debtlens scan examples/react --format html --output debtlens-report.html` | Shareable human-readable artifact. |
| JUnit | `debtlens scan examples/react --format junit --output debtlens-junit.xml` | CI systems that surface test-style failures. |

The GitHub Action runs one canonical JSON scan and renders requested reports from that
result so counts, filters, baselines, suppressions, and source links stay aligned.
PR comments use pull request head SHAs for source links when available, warn instead of
failing on missing comment permissions by default, and can summarize omitted findings
when `comment-max-findings` or `comment-max-bytes` caps are reached.

## Compare reports

Use `debtlens compare` when you already have two ScanResult JSON files and want a
trend report without rescanning:

```bash
debtlens compare previous-debtlens-report.json debtlens-report.json --format terminal
debtlens compare previous-debtlens-report.json debtlens-report.json --format markdown
debtlens compare previous-debtlens-report.json debtlens-report.json --format json
```

Compare reports include total, severity, and rule deltas. When both JSON files include
issue arrays, DebtLens also reports exact new, resolved, changed, severity-regression,
and top-new-file counts. Keep the scan target, include/exclude filters, rule selection,
and minimum severity aligned between the two reports so the trend describes the same
surface.

Scheduled CI jobs can write a fresh canonical JSON report, restore the previous report
artifact, and append the Markdown compare output to the job summary:

```yaml
- name: Compare DebtLens trend
  if: hashFiles('previous/debtlens-report.json') != ''
  run: |
    npx debtlens compare previous/debtlens-report.json current/debtlens-report.json --format markdown >> "$GITHUB_STEP_SUMMARY"
```

## Minimal Markdown excerpt

```markdown
# DebtLens Report

Scanned 3 files with 8 rules.
Issues: 4 | high 2 | medium 2 | low 0 | info 0
```

## Refresh locally

```bash
npm run build
node dist/cli/index.js scan examples/react --format json --output /tmp/debtlens-report.json
DEBTLENS_PR_COMMENT_MAX_FINDINGS=20 DEBTLENS_PR_COMMENT_MAX_BYTES=60000 node scripts/render-scan-result.mjs /tmp/debtlens-report.json pr-comment
```
