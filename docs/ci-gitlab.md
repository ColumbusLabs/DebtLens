# GitLab CI

This template publishes the canonical JSON report and gates high-severity findings.

Replace `npm ci` with `pnpm install --frozen-lockfile`, `yarn install --immutable`, or a preinstalled `debtlens` binary when your project does not use npm.

```yaml
stages:
  - quality

debtlens:
  image: node:20
  stage: quality
  script:
    - npm ci
    - npx debtlens scan . --format json --output debtlens-report.json --fail-on high
  artifacts:
    when: always
    paths:
      - debtlens-report.json
    expire_in: 14 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

For a test-style artifact, also emit JUnit:

```bash
npx debtlens scan . --format junit --output debtlens.junit.xml --fail-on high
```

Then add `debtlens.junit.xml` under `artifacts:reports:junit`.
