# False-Positive Calibration Guide

Use this guide when a first scan is noisy. Prefer tuning broad rollout controls before
adding inline suppressions.

| Situation | Prefer | Why |
| --- | --- | --- |
| Existing legacy debt | `--write-baseline` then `--baseline` | Keeps current debt visible without blocking every PR. |
| Generated or vendored files | `exclude` or `--respect-gitignore` | The scanner should not evaluate code humans do not maintain. |
| Documentation or separator comments | Upgrade, then report minimal samples if still noisy | JSDoc/TSDoc-style blocks and comment banners should not be flagged as `commented-out-code`. |
| Public framework boundary wrappers | Config scope, framework pack thresholds, or baseline | Route handlers, views, and API hook surfaces can be intentionally thin while still valuable. |
| Kotlin lifecycle or hook APIs | Baseline or suppress narrow exceptions | Empty `Unit` overrides are usually public API contracts, not duplicate business logic. |
| Framework convention that repeats safely | Pack-specific thresholds or rule config | Keeps the rule useful for real debt elsewhere. |
| Low-confidence finding family | `ruleConfidenceFloors` or `--fail-on-confidence` | Keeps findings visible while preventing weak gates. |
| One documented exception | Inline suppression with a reason | Auditable, local, and visible in JSON/SARIF output. |

## Calibrate thresholds to your repo

Default thresholds are deliberately generic. On a large legacy repo they can be noisy; on a small repo they can miss real debt. After `debtlens adopt` picks rules and severity, run calibration to tune the numbers:

```bash
# Preview percentile-based threshold suggestions (default p90)
debtlens calibrate .

# Tune aggressiveness and merge suggestions into debtlens.config.json
debtlens calibrate . --percentile 85 --write
```

Calibration temporarily lowers supported numeric trigger thresholds so the sample
includes below-threshold code, not just existing findings. The report also lists
selected policy floors, boolean switches, similarity controls, and safety caps
under **Not calibrated** when they cannot be inferred honestly from a distribution.

Calibration scans the target, collects observed metrics for threshold-driven rules (function length, branch counts, and similar), and suggests values at the chosen percentile so roughly the worst N% is flagged. Review the printed config snippet before using `--write`; unrelated config keys are preserved.

Pair calibration with payoff ranking and triage for a low-noise first rollout:

```bash
debtlens calibrate . --percentile 90
debtlens scan . --sort payoff --hotspots
debtlens triage .
```

See [`docs/prioritization.md`](./prioritization.md) for payoff scoring and per-area budgets.

## Baseline before suppressing

```bash
debtlens scan . --write-baseline debtlens-baseline.json
debtlens scan . --baseline debtlens-baseline.json --fail-on high
```

## Exclude generated surfaces

```json
{
  "exclude": ["dist/**", "build/**", "out/**", ".next/**", ".output/**", ".venv/**", "venv/**", "**/site-packages/**", "**/__generated__/**"]
}
```

Avoid scanning dependency caches, generated clients, build output, virtualenvs, and
language package caches. Keep broad folders such as `vendor/**` or `third_party/**`
as project-specific choices: some repositories maintain code there, while others only
mirror upstream code.

## Scope serious repos first

Large repositories should start with a maintained source directory, `--package`, or
`--changed origin/main` before whole-repo gating. If DebtLens warns that it scanned
only the first `maxFiles` matched files, either raise `--max-files` for a deliberate
full scan or narrow scope with `--include`, `--exclude`, `--rules`, `--changed`, and
`--respect-gitignore`.

## Tune public boundaries separately

Thin wrappers under files such as `views.py`, `routes.py`, or `api.py`, decorated web
endpoints, and Kotlin listener hooks are often framework contracts. DebtLens tries to
avoid obvious no-op public boundaries, but if a project has its own framework layer,
prefer package scope, thresholds, baselines, confidence floors, or narrow inline
suppressions over disabling a useful rule everywhere.

## Keep true dead code visible

`commented-out-code` should ignore documentation blocks and separator banners, but it
should still report real commented imports, functions, returns, and control flow. If a
commented snippet is intentionally retained, use an inline suppression with a reason or
delete the snippet and link to source control.

## Suppress a narrow exception

```ts
// debtlens-disable-next-line duplicate-logic -- generated adapter mirrors vendor API
export function mapVendorPayload(payload: VendorPayload) {
  return payload.items.map((item) => item.id);
}
```

When reporting a false positive upstream, include the command, config, version, minimal
source sample, and a ScanResult JSON excerpt if possible.

## Audit stale suppressions

Run an audit after refactors or rule tuning to catch suppressions that no longer hide findings:

```bash
debtlens scan . --audit-suppressions --format markdown
```

Unused directives should usually be removed. File-wide directives with multiple hidden findings should be reviewed and narrowed to next-line suppressions when the exception is not truly file-wide. Directives marked `not-evaluated` belong to rules outside the current scan scope; rerun the audit with that rule enabled before deciding whether they are stale.
