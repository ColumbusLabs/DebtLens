# GitHub App RFC

Status: **Evaluation**

The current GitHub Action covers CI scanning, SARIF upload, JSON artifacts, PR comments,
and step summaries. An official GitHub App is still useful only if it adds product
behavior that Actions cannot provide cleanly.

## Goals

- Centralized installation across many repositories without copying workflow YAML.
- Pull request checks and comments backed by the stable `ScanResult` JSON contract.
- Organization-level policy defaults, with repository opt-outs and local overrides.
- Optional dashboard views for debt trends across repositories.

## Non-goals

- Replacing the CLI or Action.
- Running untrusted custom plugins in the app service.
- Making DebtLens a security scanner or authorship detector.

## Recommended architecture

1. GitHub App receives pull request and push webhooks.
2. App enqueues a scan job with repository, ref, base ref, and configured policy.
3. Worker checks out the repository, installs the pinned DebtLens runtime, and runs:

```bash
debtlens scan . \
  --changed origin/main \
  --format json \
  --output debtlens-report.json \
  --fail-on high
```

4. App renders annotations, PR comments, and trend summaries from the JSON report.
5. App stores only metadata needed for trend views: repository id, commit SHA, summary
   counts, per-rule counts, and artifact links.

## Permissions

Minimum MVP permissions:

| Permission | Access | Reason |
| --- | --- | --- |
| Contents | Read | Check out the target ref for scanning. |
| Pull requests | Read/write | Read PR metadata and post or update grouped comments. |
| Checks | Read/write | Publish pass/fail status and link the report artifact. |
| Code scanning alerts | Write, optional | Upload SARIF when the installation wants GitHub code-scanning annotations. |

Repositories that only want comments can skip code-scanning permissions and continue using
the Action for SARIF upload.

## Action vs App tradeoff

| Surface | GitHub Action | GitHub App |
| --- | --- | --- |
| Install friction | Add workflow YAML per repo. | Install once per org/repo, then configure policy. |
| Runtime cost | Paid by repository Actions minutes. | Paid by the app operator. |
| Custom plugins | Runs inside the repository workflow, so trusted repos can opt in. | Should be disabled by default; trusted policy packages need explicit allowlisting. |
| PR comments | Already supported by Action inputs. | Centralized and easier to keep consistent across repos. |
| Trend storage | Requires artifact collection by the user. | Natural fit if the app stores summary metadata. |
| Maintenance | Low; mostly versioned CLI/Action releases. | Higher; hosted service, webhook retries, queue, storage, and support burden. |

## Security model

- Treat repository code as untrusted.
- Disable local plugins by default unless the organization explicitly enables trusted
  policy packages.
- Prefer ephemeral workers with no cross-repo workspace reuse.
- Never send source code to external model APIs as part of the default app workflow.
- Preserve the CLI escape hatch: users can reproduce every app finding with `npx
  debtlens scan`.

## Why not build this first

The Action already satisfies the most common adoption flow and is easier to audit. Build
the App after these signals appear:

- Multiple organizations want centralized policy rather than workflow templates.
- Maintainers need trend dashboards across many repositories.
- PR comment noise is controlled through baselines, confidence floors, and delta-only
  comments.
- The hosted service has a clear operational owner.

## MVP acceptance

- Installation page documents required permissions.
- One repository can opt into the app and receive a PR check from a changed-file scan.
- The app posts the same grouped PR comment body as the Action.
- The app links to the raw JSON report and names the DebtLens version used.
- The app gracefully skips plugin loading unless trusted policy packages are enabled.
