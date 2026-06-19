# Five-Minute Quickstart

This path is meant for a first local evaluation. It keeps the scan non-blocking, shows
what the output means, and leaves a cleanup path for generated files.

## 1. Run a safe first scan

```bash
npx debtlens scan . --min-severity medium --format terminal
```

Start with `medium` so a legacy repo does not bury useful findings under low-severity
cleanup work. The summary line shows files scanned, rules run, and counts by severity.

## 2. Pick the smallest useful pack

Use the [pack chooser](./pack-chooser.md) before enabling everything:

```bash
npx debtlens scan . --pack core --min-severity medium
npx debtlens scan . --pack react --min-severity medium
npx debtlens scan . --pack python --min-severity low
```

Mixed repos can scan multiple packs in one run:

```bash
npx debtlens scan . --pack core,python --format markdown --output debtlens-report.md
```

## 3. Get an adoption plan

```bash
npx debtlens adopt . --format markdown
```

Use the recommendation to decide whether the first CI run should be advisory, baseline
only, or a high-severity gate.

## 4. Baseline legacy debt before gating

For established repos, create a baseline first:

```bash
npx debtlens scan . --write-baseline debtlens-baseline.json
npx debtlens scan . --baseline debtlens-baseline.json --fail-on high
```

This keeps known debt visible while making the gate focus on newly introduced high-severity
findings.

## 5. Clean up trial artifacts

```bash
rm -f debtlens-report.md debtlens-report.html debtlens-report.json debtlens-baseline.json
rm -rf .debtlens
```

Keep a generated baseline only after the team has reviewed it and agreed to use
new-code-focused gating.
