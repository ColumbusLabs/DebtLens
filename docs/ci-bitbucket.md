# Bitbucket Pipelines

This template publishes the canonical JSON report, posts a Bitbucket Code
Insights report with inline annotations, and gates high-severity findings.

Replace `npm ci` with `pnpm install --frozen-lockfile`, `yarn install --immutable`, or a preinstalled `debtlens` binary when your project does not use npm.

```yaml
image: node:20

pipelines:
  pull-requests:
    "**":
      - step:
          name: DebtLens
          caches:
            - node
          script:
            - npm ci
            - |
              set +e
              npx debtlens scan . --format json --output debtlens-report.json --fail-on high
              status=$?
              DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT=100 \
                node node_modules/debtlens/scripts/post-bitbucket-code-insights.mjs debtlens-report.json
              post_status=$?
              if [ "$post_status" -ne 0 ]; then
                exit "$post_status"
              fi
              exit $status
          artifacts:
            - debtlens-report.json
```

The Code Insights helper reads the canonical JSON report, creates or updates a
commit report at `reports/debtlens`, and bulk-posts annotations with stable
DebtLens IDs, repository-relative paths, line numbers, severities, rule codes,
and details. The helper sorts findings by severity and confidence before
applying `DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT`; Bitbucket accepts up to 100
annotations per request and 1000 annotations per report, so the helper chunks
large uploads automatically.

## Credentials

Store credentials as secured repository variables:

- `BITBUCKET_USERNAME`: the bot or service account email.
- `BITBUCKET_API_TOKEN`: a Bitbucket API token with repository access.

The helper also accepts bearer credentials through `BITBUCKET_STEP_OAUTH_TOKEN`,
`BITBUCKET_TOKEN`, or `BB_TOKEN`, and a prebuilt
`DEBTLENS_BITBUCKET_AUTH_HEADER` for custom runners. Standard Bitbucket
Pipelines variables provide `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`,
`BITBUCKET_COMMIT`, and `BITBUCKET_CLONE_DIR`.

Posting is warn-only by default. If credentials or Bitbucket context are missing
for a forked or restricted pull request, the helper skips Code Insights while the
JSON artifact and scan gate still run. If Bitbucket rejects the report, the
helper writes a warning and exits 0; set
`DEBTLENS_BITBUCKET_FAIL_ON_ERROR=true` when report-posting failures should fail
the pipeline.

Optional controls:

- `DEBTLENS_BITBUCKET_REPORT_ID`: report key, default `debtlens`.
- `DEBTLENS_BITBUCKET_REPORT_LINK`: link from the Code Insights report to a full artifact or dashboard.
- `DEBTLENS_BITBUCKET_ANNOTATIONS_MAX_COUNT`: annotation cap from 0 to 1000, default 100.
- `BITBUCKET_API_URL`: alternate Bitbucket API base URL for compatible runners.

For large workspaces, start narrow:

```bash
npx debtlens scan . --package web --pack core --max-files 500 --format json --output debtlens-report.json
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
