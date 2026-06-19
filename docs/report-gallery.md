# Report Gallery

DebtLens renders one `ScanResult` into several surfaces. Pick the format based on where
reviewers already work.

| Format | Command | Best use |
| --- | --- | --- |
| Terminal | `debtlens scan examples/react --format terminal` | Local inspection and quick triage. |
| JSON | `debtlens scan examples/react --format json --output debtlens-report.json` | Integrations, dashboards, and trend tooling. |
| Markdown | `debtlens scan examples/react --format markdown --output debtlens-report.md` | PR descriptions, release notes, and maintainer handoffs. |
| PR comment | `debtlens scan examples/react --format pr-comment --output debtlens-pr-comment.md` | Compact GitHub review comments. |
| SARIF | `debtlens scan examples/react --format sarif --output debtlens.sarif` | GitHub code scanning and compatible quality dashboards. |
| HTML | `debtlens scan examples/react --format html --output debtlens-report.html` | Shareable human-readable artifact. |
| JUnit | `debtlens scan examples/react --format junit --output debtlens-junit.xml` | CI systems that surface test-style failures. |

The GitHub Action runs one canonical JSON scan and renders requested reports from that
result so counts, filters, baselines, suppressions, and source links stay aligned.

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
node scripts/render-scan-result.mjs /tmp/debtlens-report.json pr-comment
```
