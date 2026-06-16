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

Baseline issue paths are package-relative when `--package` is used, so keep the package flag consistent between baseline creation and CI enforcement.
