# False-Positive Calibration Guide

Use this guide when a first scan is noisy. Prefer tuning broad rollout controls before
adding inline suppressions.

| Situation | Prefer | Why |
| --- | --- | --- |
| Existing legacy debt | `--write-baseline` then `--baseline` | Keeps current debt visible without blocking every PR. |
| Generated or vendored files | `exclude` or `--respect-gitignore` | The scanner should not evaluate code humans do not maintain. |
| Framework convention that repeats safely | Pack-specific thresholds or rule config | Keeps the rule useful for real debt elsewhere. |
| Low-confidence finding family | `ruleConfidenceFloors` or `--fail-on-confidence` | Keeps findings visible while preventing weak gates. |
| One documented exception | Inline suppression with a reason | Auditable, local, and visible in JSON/SARIF output. |

## Baseline before suppressing

```bash
debtlens scan . --write-baseline debtlens-baseline.json
debtlens scan . --baseline debtlens-baseline.json --fail-on high
```

## Exclude generated surfaces

```json
{
  "exclude": ["dist/**", "build/**", ".next/**", "generated/**"]
}
```

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
