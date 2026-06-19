# Monorepo Baselines

For monorepos, keep baselines per package instead of one giant root file. This keeps ownership clear and avoids unrelated teams touching the same baseline.

Recommended naming:

```text
debtlens-baseline.web.json
debtlens-baseline.api.json
debtlens-baseline.admin.json
```

Create a baseline for one package:

```bash
debtlens scan . --package web --write-baseline debtlens-baseline.web.json
```

Gate new findings for that package:

```bash
debtlens scan . \
  --package web \
  --baseline debtlens-baseline.web.json \
  --fail-on-regression \
  --fail-on high
```

For package-specific adoption reports:

```bash
debtlens adopt . --package web --format markdown
```

Maintain each package baseline with the same package scan scope:

```bash
debtlens baseline diff . --package web --baseline debtlens-baseline.web.json
debtlens baseline update . --package web --baseline debtlens-baseline.web.json
```

`diff` does not write files, and `update` rewrites the baseline to the current package
scan result. Legacy baselines are supported. Mutating `prune` refuses `--package` and other
explicitly scoped CLI scans because DebtLens cannot prove that a narrower scan covers every
entry in an older baseline. Baseline issue paths are package-relative when `--package` is
used, so keep the package flag and other scan options consistent between baseline creation,
CI enforcement, and maintenance.
