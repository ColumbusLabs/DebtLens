# GitLab CI

This template publishes the canonical JSON report, a native GitLab Code Quality
report, and gates high-severity findings.

Replace `npm ci` with `pnpm install --frozen-lockfile`, `yarn install --immutable`, or a preinstalled `debtlens` binary when your project does not use npm.

```yaml
stages:
  - quality

debtlens:
  image: node:20
  stage: quality
  script:
    - npm ci
    - |
      set +e
      npx debtlens scan . --format json --output debtlens-report.json --fail-on high
      status=$?
      npx debtlens scan . --format gitlab-codequality --output gl-code-quality-report.json
      exit $status
  artifacts:
    when: always
    paths:
      - debtlens-report.json
      - gl-code-quality-report.json
    reports:
      codequality: gl-code-quality-report.json
    expire_in: 14 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

`gitlab-codequality` emits GitLab's CodeClimate-style JSON array with stable
DebtLens fingerprints, repository-relative paths, line numbers, descriptions,
rule names, and mapped severities. Keep the canonical JSON artifact as the full
DebtLens contract for trends, baselines, and follow-up automation.

## New-code gate

For merge request pipelines, gate only findings introduced by the source branch
while still publishing the full Code Quality report:

```yaml
debtlens-new-code:
  image: node:20
  stage: quality
  script:
    - npm ci
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - |
      set +e
      npx debtlens scan . --diff-base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --format json --output debtlens-report.json --fail-on high
      status=$?
      npx debtlens scan . --format gitlab-codequality --output gl-code-quality-report.json
      exit $status
  artifacts:
    when: always
    paths:
      - debtlens-report.json
      - gl-code-quality-report.json
    reports:
      codequality: gl-code-quality-report.json
```

`--diff-base` keeps the gate focused on new findings. The Code Quality artifact
can stay full-scope so reviewers still see the complete DebtLens context in
GitLab.

## Legacy baseline gate

For repositories with known existing debt, commit a baseline and gate only
findings absent from that snapshot:

```bash
npx debtlens scan . --write-baseline debtlens-baseline.json
```

```yaml
debtlens-baseline:
  image: node:20
  stage: quality
  script:
    - npm ci
    - |
      set +e
      npx debtlens scan . --baseline debtlens-baseline.json --format json --output debtlens-report.json --fail-on high
      status=$?
      npx debtlens scan . --format gitlab-codequality --output gl-code-quality-report.json
      exit $status
  artifacts:
    when: always
    paths:
      - debtlens-report.json
      - gl-code-quality-report.json
    reports:
      codequality: gl-code-quality-report.json
```

Refresh the baseline deliberately when the team accepts or removes existing
findings; do not regenerate it automatically inside every merge request.

For a test-style artifact, also emit JUnit:

```bash
npx debtlens scan . --format junit --junit-fail-on high --output debtlens.junit.xml --fail-on high
```

Then add `debtlens.junit.xml` under `artifacts:reports:junit`. `--fail-on` controls the CLI exit code; `--junit-fail-on` controls which reported findings become failed testcases.
