# Azure Pipelines

This template publishes the canonical JSON report, emits native Azure log issues,
and gates high-severity findings.

For Azure Repos PR validation, configure this pipeline as a branch-policy build validation. For GitHub or Bitbucket-backed Azure Pipelines, add a `pr:` trigger that matches your target branches.

Replace `npm ci` with `pnpm install --frozen-lockfile`, `yarn install --immutable`, or a preinstalled `debtlens` binary when your project does not use npm.

```yaml
trigger:
  - main
pr:
  - main

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: "20.x"

  - script: npm ci
    displayName: Install dependencies

  - script: |
      set +e
      npx debtlens scan . --format json --output debtlens-report.json --fail-on high
      status=$?
      DEBTLENS_AZURE_ERROR_ON=high node node_modules/debtlens/scripts/emit-azure-log-issues.mjs debtlens-report.json
      exit $status
    displayName: Run DebtLens

  - publish: debtlens-report.json
    artifact: debtlens-report
    condition: always()
```

Azure logging commands must be written to stdout from a script step. The
`emit-azure-log-issues.mjs` helper reads the canonical JSON report and writes
`task.logissue` entries with file, line, rule code, and escaped messages.
`DEBTLENS_AZURE_ERROR_ON` maps findings at or above that severity to Azure
errors; lower severities are warnings. Keep `--fail-on` on the scan command as
the actual quality gate.

Azure can also publish JUnit-style reports:

```yaml
- script: npx debtlens scan . --format junit --junit-fail-on high --output debtlens.junit.xml --fail-on high
  displayName: Run DebtLens JUnit

- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: debtlens.junit.xml
```

`--fail-on` controls the CLI exit code; `--junit-fail-on` controls which reported findings become failed testcases while lower severities remain visible as skipped testcases.
