# Five-Minute Quickstart

This path is meant for a first local evaluation. It keeps the scan non-blocking, shows
what the output means, and leaves a cleanup path for generated files.

## 1. Run a safe first scan

```bash
npx --yes --package=debtlens@latest debtlens scan . --min-severity medium --format terminal
```

Start with `medium` so a legacy repo does not bury useful findings under low-severity
cleanup work. The summary line shows files scanned, rules run, and counts by severity.

## 2. Pick the smallest useful pack

Use the [pack chooser](./pack-chooser.md) before enabling everything:

```bash
npx --yes --package=debtlens@latest debtlens scan . --pack core --min-severity medium
npx --yes --package=debtlens@latest debtlens scan . --pack react --min-severity medium
npx --yes --package=debtlens@latest debtlens scan . --pack python --min-severity low
npx --yes --package=debtlens@latest debtlens scan . --pack python-web --min-severity low
npx --yes --package=debtlens@latest debtlens scan . --pack vue --min-severity low
npx --yes --package=debtlens@latest debtlens scan . --pack svelte --min-severity low
npx --yes --package=debtlens@latest debtlens scan . --pack kotlin --min-severity low
npx --yes --package=debtlens@latest debtlens scan . --pack compose --min-severity low
```

Mixed repos can scan multiple packs in one run:

```bash
npx --yes --package=debtlens@latest debtlens scan . --pack core,python-web,vue,svelte,kotlin,compose --format markdown --output debtlens-report.md
```

## 3. Get an adoption plan

```bash
npx --yes --package=debtlens@latest debtlens adopt . --format markdown
```

Use the recommendation to decide whether the first CI run should be advisory, baseline
only, or a high-severity gate. The named presets are the shortest way to express that
choice:

```bash
npx --yes --package=debtlens@latest debtlens scan . --gate advisory
npx --yes --package=debtlens@latest debtlens scan . --gate new-code --diff-base origin/main
npx --yes --package=debtlens@latest debtlens scan . --gate strict-new-code --diff-base origin/main
```

Start with `advisory` while tuning rules. Move to `new-code` when pull requests should
block high-severity new findings, and tighten to `strict-new-code` after owners agree
that medium-severity new findings and count regressions should fail CI.

For serious repos, start narrower than the whole tree. Use `adopt` for the rollout
plan, then try `--changed origin/main`, a maintained source subdirectory, or
`--package <name>` before broad scans. If the scan warns that only the first
`maxFiles` matched files were scanned, either raise `--max-files` deliberately or
narrow with `--include`, `--exclude`, `--rules`, `--changed`, and
`--respect-gitignore`. Baseline legacy findings before turning the scan into a
blocking gate.

## 4. Baseline legacy debt before gating

For established repos, create a baseline first:

```bash
npx --yes --package=debtlens@latest debtlens scan . --write-baseline debtlens-baseline.json
npx --yes --package=debtlens@latest debtlens scan . --gate legacy-baseline --baseline debtlens-baseline.json
```

This keeps known debt visible while making the gate focus on newly introduced high-severity
findings.

The legacy migration path is `legacy-baseline` first, then `strict-new-code` for pull
requests once the baseline is pruned and the team is ready to keep newly touched code
cleaner than the historical snapshot:

```bash
npx --yes --package=debtlens@latest debtlens scan . --gate legacy-baseline --baseline debtlens-baseline.json
npx --yes --package=debtlens@latest debtlens scan . --gate strict-new-code --diff-base origin/main
```

When the team fixes legacy debt, maintain the same file instead of replacing it blindly:

```bash
npx --yes --package=debtlens@latest debtlens baseline diff . --baseline debtlens-baseline.json
npx --yes --package=debtlens@latest debtlens baseline prune . --baseline debtlens-baseline.json --dry-run
npx --yes --package=debtlens@latest debtlens baseline prune . --baseline debtlens-baseline.json
npx --yes --package=debtlens@latest debtlens baseline update . --baseline debtlens-baseline.json
```

`diff` and `--dry-run` do not write files. `prune` removes resolved entries, while
`update` rewrites the baseline to the current scan result. Legacy baselines are supported.
Run each maintenance command with the same target and scan options used to create the
baseline, including pack, rule, threshold, package, include, and exclude choices.
Mutating `prune` only runs for the default full-scope scan without config-driven scope
changes; use `diff` for scoped previews and `update` when you intentionally want to
rewrite a scoped baseline.

## 5. Clean up trial artifacts

```bash
rm -f debtlens-report.md debtlens-report.html debtlens-report.json debtlens-baseline.json
rm -rf .debtlens
```

Keep a generated baseline only after the team has reviewed it and agreed to use
new-code-focused gating.
