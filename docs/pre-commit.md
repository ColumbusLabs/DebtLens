# Pre-Commit Hooks

Use pre-commit hooks for fast local feedback, not as the only quality gate. Keep CI as the source of truth because developers can bypass local hooks.

## Plain Git Hook

Create `.git/hooks/pre-commit`:

```bash
#!/usr/bin/env bash
set -euo pipefail

npx debtlens scan . --staged --fail-on high --fail-on-confidence 0.8
```

Then make it executable:

```bash
chmod +x .git/hooks/pre-commit
```

## Husky

```bash
npm install --save-dev husky
npx husky init
```

Add this to `.husky/pre-commit`:

```bash
npx debtlens scan . --staged --fail-on high --fail-on-confidence 0.8
```

## Softer Local Variant

Teams adopting DebtLens for the first time often prefer a warning-only local hook:

```bash
npx debtlens scan . --staged --min-severity medium --format terminal || true
```

Pair that with a CI job that writes a JSON report and gates only the findings your team agrees are merge-blocking.
