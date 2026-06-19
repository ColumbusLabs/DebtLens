# GitLab CI

This template publishes the canonical JSON report, a native GitLab Code Quality
report, and demonstrates the named quality-gate presets: `advisory`, `new-code`,
`strict-new-code`, and `legacy-baseline`.

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
      npx debtlens scan . --gate advisory --format json --output debtlens-report.json
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
      npx debtlens scan . --gate new-code --diff-base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --format json --output debtlens-report.json
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

`--gate new-code` keeps the gate focused on high-severity new findings. The Code Quality artifact
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
      npx debtlens scan . --gate legacy-baseline --baseline debtlens-baseline.json --format json --output debtlens-report.json
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

## Strict new-code migration

Clean or near-clean repositories should run `--gate advisory` first, move to
`--gate new-code --diff-base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"` when
high-severity new findings should block merge requests, then tighten to
`--gate strict-new-code` after rule tuning is stable:

```bash
npx debtlens scan . --gate strict-new-code --diff-base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --format json --output debtlens-report.json
```

Legacy repositories usually stay on `--gate legacy-baseline` while pruning the
committed baseline, then use `strict-new-code` for merge requests so newly changed
code is held to the stricter policy without reopening every historical finding.

For a test-style artifact, also emit JUnit:

```bash
npx debtlens scan . --format junit --junit-fail-on high --output debtlens.junit.xml --fail-on high
```

Then add `debtlens.junit.xml` under `artifacts:reports:junit`. `--fail-on` controls the CLI exit code; `--junit-fail-on` controls which reported findings become failed testcases.
