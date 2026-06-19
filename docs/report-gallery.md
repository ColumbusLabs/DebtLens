# Report Gallery

DebtLens renders one `ScanResult` into several surfaces. Pick the format based on where
reviewers already work.

| Format | Command | Best use |
| --- | --- | --- |
| Terminal | `debtlens scan examples/react --format terminal` | Local inspection and quick triage. |
| JSON | `debtlens scan examples/react --format json --output debtlens-report.json` | Integrations, dashboards, and trend tooling. |
| Markdown | `debtlens scan examples/react --format markdown --output debtlens-report.md` | PR descriptions, release notes, and maintainer handoffs. |
| PR comment | `debtlens scan examples/react --format pr-comment --output debtlens-pr-comment.md` | Compact GitHub review comments with prioritized fix targets and optional caps. |
| SARIF | `debtlens scan examples/react --format sarif --sarif-category examples-react --output debtlens.sarif` | GitHub code scanning and compatible quality dashboards. |
| HTML | `debtlens scan examples/react --format html --output debtlens-report.html` | Shareable human-readable artifact. |
| JUnit | `debtlens scan examples/react --format junit --junit-fail-on high --output debtlens-junit.xml` | CI systems that surface test-style failures while keeping lower severities visible. |
| GitLab Code Quality | `debtlens scan examples/react --format gitlab-codequality --output gl-code-quality-report.json` | Native GitLab Merge Request Code Quality widgets. |

The GitHub Action runs one canonical JSON scan and renders requested reports from that
result so counts, filters, baselines, suppressions, and source links stay aligned.
PR comments use pull request head SHAs for source links when available, warn instead of
failing on missing comment permissions by default, and can summarize omitted findings
when `comment-max-findings` or `comment-max-bytes` caps are reached.
Step summaries include gate decisions, warnings, filter stats, report paths, artifacts,
and optional trend comparisons. The Action also exposes issue-count outputs and can emit
capped workflow command annotations when SARIF/code scanning is not configured.
SARIF findings include stable `partialFingerprints`; set `sarif-category` when separate
package or rule-pack runs should appear as distinct code scanning analyses.
GitLab Code Quality output uses GitLab's required JSON array shape with stable
DebtLens fingerprints. Azure Pipelines can keep the canonical JSON artifact and
emit native `task.logissue` entries by running `scripts/emit-azure-log-issues.mjs`
against that report.

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
artifact, and pass it to the Action for a step-summary trend. Missing previous reports
are treated as soft warnings. The README includes complete copy-paste workflows for both
pull request trends and scheduled main-branch trends; the Action step is:

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    previous-report: previous/debtlens-report.json
    json-output: current/debtlens-report.json
    upload-json-artifact: true
    step-summary: true
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
