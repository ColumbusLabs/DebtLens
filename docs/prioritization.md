# Payoff prioritization

DebtLens can rank findings by **payoff score** so teams fix the debt that costs the most first instead of working through a flat severity list.

## When scores appear

Each issue gets a `payoffScore` in JSON output when payoff ranking is enabled:

- pass `--sort payoff` on `debtlens scan`, or
- enable git churn hotspots with `--hotspots` on the CLI, or
- pass `--blame-age` to include age in the score.

Terminal, Markdown, and HTML reports include a **Top payoff targets** section when any issue carries a score.

## Scoring formula

Payoff combines signals already present on each finding:

```
payoffScore = severityWeight × confidence × churnFactor × ageFactor
```

| Factor | Default behavior |
| --- | --- |
| `severityWeight` | high 16, medium 8, low 3, info 1 |
| `confidence` | issue confidence, floored at 0.35 |
| `churnFactor` | `1 + log2(1 + churnMetric) × churnWeight` when hotspot data exists; otherwise 1 |
| `ageFactor` | `1 + min(introducedDaysAgo / 365, 2) × ageWeight` when blame age is available; otherwise 1 |

Churn metrics come from [`src/core/hotspots.ts`](../src/core/hotspots.ts). Age uses optional `introducedDaysAgo` from `--blame-age`.

## CLI usage

```bash
# Sort findings by payoff and show top targets in the terminal report
debtlens scan . --sort payoff --hotspots

# JSON consumers read payoffScore on each issue
debtlens scan . --sort payoff --format json
```

Use `--hotspots` when git history is available so churn boosts files that change often. In CI, check out enough history (`fetch-depth: 0` or a bounded `--churn-range`).

## Config weights

Tune weights under the `priority` block in `debtlens.config.json`:

```json
{
  "priority": {
    "severity": { "high": 20, "medium": 10, "low": 4, "info": 1 },
    "churn": 1.2,
    "age": 0.75
  }
}
```

Higher `churn` and `age` weights amplify those factors. Severity weights follow the same keys as built-in severities.

## Adoption workflow

Payoff ranking fits between calibration and triage:

1. `debtlens calibrate` — tune thresholds to your repo (see [`docs/false-positives.md`](./false-positives.md)).
2. `debtlens scan . --sort payoff --hotspots` — review the highest-ROI findings first.
3. `debtlens triage` — baseline or suppress the backlog interactively.
4. Add `budgets` — cap debt per directory after cleanup (see below).

## Per-area budgets

After triage, protect cleaned areas with path budgets:

```json
{
  "budgets": {
    "src/payments": { "maxIssues": 20, "maxHigh": 0 },
    "src/legacy": { "maxIssues": 250 }
  }
}
```

- Budget breaches fail the scan gate (exit code 1) like `--fail-on`.
- `debtlens scan --budget-report` prints used/budget/headroom without failing — useful in CI dashboards.

Keys are path globs (`src/payments/**`, `src/**/*.ts`, or exact prefixes).
