# Good first issues

Scoped, self-contained tasks for new contributors. Each entry links to a tracked GitHub
issue with acceptance criteria. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for setup.

**Labels:** `good first issue` (general) · `good-first-rule` (detector/rule work)

Statuses reflect the current repository surface. **Done** means the GitHub issue is closed.

## Rules

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 1 | Make the `prop-drilling` host-component list configurable | [#1](https://github.com/ColumbusLabs/DebtLens/issues/1) | Open |
| 2 | Teach `large-component` to recognize `memo`, `forwardRef`, and class components | [#2](https://github.com/ColumbusLabs/DebtLens/issues/2) | Open |
| 3 | Reduce `naming-drift` false positives on domain-rich apps | [#3](https://github.com/ColumbusLabs/DebtLens/issues/3) | Open |
| 4 | Configurable markers for `todo-comment` | [#4](https://github.com/ColumbusLabs/DebtLens/issues/4) | Open |
| 15 | Extend `effect-complexity` to `useLayoutEffect` / `useInsertionEffect` | [#15](https://github.com/ColumbusLabs/DebtLens/issues/15) | **Done** |
| 27 | Warn when `duplicate-logic` hits `maxSnippets` cap | [#27](https://github.com/ColumbusLabs/DebtLens/issues/27) | **Done** |

### 1. Make the `prop-drilling` host-component list configurable — [#1](https://github.com/ColumbusLabs/DebtLens/issues/1)

The ignore list of UI primitives lives in [`src/utils/hostComponents.ts`](../src/utils/hostComponents.ts).
Add an optional config key (e.g. `propDrilling.ignoreComponents`) that extends it, so
teams can register their own design-system primitives.

- Touch: `src/core/types.ts`, `src/config/*`, `src/detectors/propDrilling.ts`, schema.
- Verify: a test where a custom-ignored component is not counted.

### 2. Teach `large-component` to recognize more component forms — [#2](https://github.com/ColumbusLabs/DebtLens/issues/2)

Today it only classifies PascalCase function/arrow components
([`src/utils/ast.ts`](../src/utils/ast.ts) `collectFunctionLikes`). It misses
`memo(function X(){})`, `forwardRef(...)`, and class components.

- Verify: fixtures for each form in `tests/detectors/largeComponent.test.ts`.

### 3. Reduce `naming-drift` false positives on domain-rich apps — [#3](https://github.com/ColumbusLabs/DebtLens/issues/3)

The built-in media vocabulary treats distinct domain entities (e.g. `movie` vs `show`)
as "competing names." Options: raise the default `minVariants`, add a config switch to
disable the built-in pack, or require co-occurrence in the same identifier.

- Touch: [`src/detectors/namingDrift.ts`](../src/detectors/namingDrift.ts).
- Verify: a media-style fixture that should NOT fire by default.

### 4. Configurable markers for `todo-comment` — [#4](https://github.com/ColumbusLabs/DebtLens/issues/4)

Allow projects to add/replace the marker patterns
([`src/detectors/todoComment.ts`](../src/detectors/todoComment.ts)) via config.

- Verify: a custom marker fires; a removed default does not.

### 15. Extend `effect-complexity` to layout/insertion effects — [#15](https://github.com/ColumbusLabs/DebtLens/issues/15) (closed)

- Touch: `src/detectors/effectComplexity.ts`, `tests/detectors/effectComplexity.test.ts`.
- Verify: long `useLayoutEffect` fires; small `useInsertionEffect` does not.

### 27. Warn when `duplicate-logic` truncates comparisons — [#27](https://github.com/ColumbusLabs/DebtLens/issues/27) (closed)

- Touch: `src/detectors/duplicateLogic.ts`.
- Verify: exceeding `maxSnippets` emits a single clear warning.

## Reporters & integrations

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 5 | Add `helpUri` to SARIF rules | [#5](https://github.com/ColumbusLabs/DebtLens/issues/5) | **Done** |
| 6 | Snapshot test for the Markdown reporter | [#6](https://github.com/ColumbusLabs/DebtLens/issues/6) | **Done** |
| 7 | Publish the config JSON schema to a stable URL | [#7](https://github.com/ColumbusLabs/DebtLens/issues/7) | **Done** |
| 16 | JSON reporter contract test | [#16](https://github.com/ColumbusLabs/DebtLens/issues/16) | **Done** |
| 22 | PR comment reporter for Markdown findings | [#22](https://github.com/ColumbusLabs/DebtLens/issues/22) | **Done** |

### 5. Add `helpUri` to SARIF rules — [#5](https://github.com/ColumbusLabs/DebtLens/issues/5) (closed)

In [`src/reporters/sarifReporter.ts`](../src/reporters/sarifReporter.ts), point each
rule's `helpUri` at its section in `docs/rules.md` so code-scanning links to docs.

- Touch: `src/reporters/sarifReporter.ts`, `tests/reporters/sarifReporter.test.ts`.
- Verify: every SARIF rule descriptor includes a `docs/rules.md` `helpUri`.

### 6. Snapshot test for the Markdown reporter — [#6](https://github.com/ColumbusLabs/DebtLens/issues/6) (closed)

Add a fixture-based test that scans `examples/react` and asserts the Markdown matches a
committed snapshot (normalizing the elapsed-ms line), guarding `docs/example-report.md`.

- Touch: `tests/reporters/markdownReporter.test.ts`, `docs/example-report.md`.
- Verify: snapshot test normalizes elapsed time and compares against the committed fixture.

### 7. Publish the config JSON schema to a stable URL — [#7](https://github.com/ColumbusLabs/DebtLens/issues/7) (closed)

The schema is generated to `schema/debtlens.config.schema.json`
([`src/config/schema.ts`](../src/config/schema.ts)). Wire up hosting (e.g. GitHub Pages
or SchemaStore) and confirm the `$schema` URL in the `init` template resolves.

- Touch: `src/config/schema.ts`, `src/config/template.ts`, `schema/debtlens.config.schema.json`, `README.md`.
- Verify: config tests assert the stable raw GitHub URL and JSON resolution.

### 16. JSON reporter contract test — [#16](https://github.com/ColumbusLabs/DebtLens/issues/16) (closed)

- Touch: `src/reporters/jsonReporter.ts`, new `tests/reporters/jsonReporter.test.ts`.
- Verify: parsed output includes stable `issues`, `summary`, `options` keys.

### 22. PR comment reporter — [#22](https://github.com/ColumbusLabs/DebtLens/issues/22) (closed)

Format scan results for GitHub PR comments (roadmap v0.3). Larger than a single rule tweak.

- Touch: `src/reporters/prCommentReporter.ts`, `src/cli/index.ts`, `README.md`, `action.yml`.
- Verify: reporter and CLI tests cover grouped annotations, empty state, invalid format messaging, and GitHub source links.

## CLI / DX

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 8 | Summary-only `--quiet` output mode | [#8](https://github.com/ColumbusLabs/DebtLens/issues/8) | **Done** |
| 9 | Respect `.gitignore` when resolving files | [#9](https://github.com/ColumbusLabs/DebtLens/issues/9) | **Done** |
| 10 | False-positive guidance per rule in docs | [#10](https://github.com/ColumbusLabs/DebtLens/issues/10) | **Done** |
| 14 | Document `--quiet` in README and Action | [#14](https://github.com/ColumbusLabs/DebtLens/issues/14) | **Done** |
| 17 | Integration test for `scan()` on `examples/react` | [#17](https://github.com/ColumbusLabs/DebtLens/issues/17) | **Done** |
| 18 | Read CLI/SARIF version from `package.json` | [#18](https://github.com/ColumbusLabs/DebtLens/issues/18) | **Done** |
| 19 | `debtlens rules` command | [#19](https://github.com/ColumbusLabs/DebtLens/issues/19) | **Done** |
| 20 | Warn when scan resolves zero files | [#20](https://github.com/ColumbusLabs/DebtLens/issues/20) | **Done** |
| 21 | `--staged` mode for pre-commit scans | [#21](https://github.com/ColumbusLabs/DebtLens/issues/21) | **Done** |
| 24 | Action: `write-baseline`, `thresholds`, `max-files` | [#24](https://github.com/ColumbusLabs/DebtLens/issues/24) | **Done** |
| 28 | CI smoke scan for RN and Next examples | [#28](https://github.com/ColumbusLabs/DebtLens/issues/28) | **Done** |

### 8. Add a summary-only / `--quiet` output mode — [#8](https://github.com/ColumbusLabs/DebtLens/issues/8) (closed)

Merged in PR #12. Terminal-only; prints header + summary, suppresses findings.

### 9. Respect `.gitignore` when resolving files — [#9](https://github.com/ColumbusLabs/DebtLens/issues/9) (closed)

Optionally skip files ignored by git during a scan, in addition to the configured
`exclude` globs.

- Touch: `src/core/scan.ts`, `src/utils/git.ts`, `src/cli/index.ts`, `action.yml`, config schema/types.
- Verify: utility, core scan, and CLI tests cover opt-in filtering plus non-git graceful behavior.

### 10. Document each rule's false-positive guidance — [#10](https://github.com/ColumbusLabs/DebtLens/issues/10) (closed)

Expand [`docs/rules.md`](./rules.md) with a "When this is a false positive" note per
rule, mirroring the guards in the detector tests.

### 14. Document `--quiet` in README and GitHub Action — [#14](https://github.com/ColumbusLabs/DebtLens/issues/14) (closed)

- Touch: `README.md`, `action.yml`.

### 17. Integration test for `scan()` — [#17](https://github.com/ColumbusLabs/DebtLens/issues/17) (closed)

- Touch: `tests/core/scan.test.ts`, `examples/react/`.

### 18. Single source of truth for version — [#18](https://github.com/ColumbusLabs/DebtLens/issues/18) (closed)

- Touch: `src/cli/index.ts`, `src/reporters/sarifReporter.ts`, `package.json`.

### 19. `debtlens rules` command — [#19](https://github.com/ColumbusLabs/DebtLens/issues/19) (closed)

List rule ids, names, default severities, and descriptions.

### 20. Warn on zero files scanned — [#20](https://github.com/ColumbusLabs/DebtLens/issues/20) (closed)

- Touch: `src/core/scan.ts`, `src/cli/index.ts`.

### 21. `--staged` git mode — [#21](https://github.com/ColumbusLabs/DebtLens/issues/21) (closed)

- Touch: `src/utils/git.ts`, `src/cli/index.ts`.

### 24. GitHub Action input gaps — [#24](https://github.com/ColumbusLabs/DebtLens/issues/24) (closed)

Expose `write-baseline`, `thresholds`, and `max-files` in `action.yml`.

### 28. CI example coverage — [#28](https://github.com/ColumbusLabs/DebtLens/issues/28) (closed)

Scan `examples/react-native` and `examples/next` in `.github/workflows/ci.yml`.

## Roadmap / larger work

| # | Task | Issue |
| --- | --- | --- |
| 23 | Monorepo and package-aware scanning | [#23](https://github.com/ColumbusLabs/DebtLens/issues/23) |
| 25 | Rule packs (`react`, `react-native`, `next`) | [#25](https://github.com/ColumbusLabs/DebtLens/issues/25) |
| 26 | Plugin API for third-party rules | [#26](https://github.com/ColumbusLabs/DebtLens/issues/26) |

These are multi-PR efforts; read the issue body before starting and comment if you plan
to own one.
