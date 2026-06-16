# Bitbucket Pipelines

This template publishes the canonical JSON report and gates high-severity findings.

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
            - npx debtlens scan . --format json --output debtlens-report.json --fail-on high
          artifacts:
            - debtlens-report.json
```

For large workspaces, start narrow:

```bash
npx debtlens scan . --package web --pack core --max-files 500 --format json --output debtlens-report.json
```
