# Azure Pipelines

This template publishes the canonical JSON report and gates high-severity findings.

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

  - script: npx debtlens scan . --format json --output debtlens-report.json --fail-on high
    displayName: Run DebtLens

  - publish: debtlens-report.json
    artifact: debtlens-report
    condition: always()
```

Azure can also publish JUnit-style reports:

```yaml
- script: npx debtlens scan . --format junit --output debtlens.junit.xml --fail-on high
  displayName: Run DebtLens JUnit

- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: debtlens.junit.xml
```
