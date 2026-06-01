# Good first issues

Scoped, self-contained tasks for new contributors. Each lists where to start and how to
verify. Open these as GitHub issues (label `good-first-rule` / `good-first-issue`) once
the repo is public. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for setup.

## Rules

### 1. Make the `prop-drilling` host-component list configurable
The ignore list of UI primitives lives in [`src/utils/hostComponents.ts`](../src/utils/hostComponents.ts).
Add an optional config key (e.g. `propDrilling.ignoreComponents`) that extends it, so
teams can register their own design-system primitives.
- Touch: `src/core/types.ts`, `src/config/*`, `src/detectors/propDrilling.ts`, schema.
- Verify: a test where a custom-ignored component is not counted.

### 2. Teach `large-component` to recognize more component forms
Today it only classifies PascalCase function/arrow components
([`src/utils/ast.ts`](../src/utils/ast.ts) `collectFunctionLikes`). It misses
`memo(function X(){})`, `forwardRef(...)`, and class components.
- Verify: fixtures for each form in `tests/detectors/largeComponent.test.ts`.

### 3. Reduce `naming-drift` false positives on domain-rich apps
The built-in media vocabulary treats distinct domain entities (e.g. `movie` vs `show`)
as "competing names." Options: raise the default `minVariants`, add a config switch to
disable the built-in pack, or require co-occurrence in the same identifier.
- Touch: [`src/detectors/namingDrift.ts`](../src/detectors/namingDrift.ts).
- Verify: a media-style fixture that should NOT fire by default.

### 4. Configurable markers for `todo-comment`
Allow projects to add/replace the marker patterns
([`src/detectors/todoComment.ts`](../src/detectors/todoComment.ts)) via config.
- Verify: a custom marker fires; a removed default does not.

## Reporters & integrations

### 5. Add `helpUri` to SARIF rules
In [`src/reporters/sarifReporter.ts`](../src/reporters/sarifReporter.ts), point each
rule's `helpUri` at its section in `docs/rules.md` so code-scanning links to docs.
- Verify: extend `tests/reporters/sarifReporter.test.ts`.

### 6. Snapshot test for the Markdown reporter
Add a fixture-based test that scans `examples/react` and asserts the Markdown matches a
committed snapshot (normalizing the elapsed-ms line), guarding `docs/example-report.md`.

### 7. Publish the config JSON schema to a stable URL
The schema is generated to `schema/debtlens.config.schema.json`
([`src/config/schema.ts`](../src/config/schema.ts)). Wire up hosting (e.g. GitHub Pages
or SchemaStore) and confirm the `$schema` URL in the `init` template resolves.

## CLI / DX

### 8. Add a summary-only / `--quiet` output mode
Print just the counts line and exit code, useful for CI logs.
- Touch: `src/cli/index.ts`, `src/reporters/terminalReporter.ts`.

### 9. Respect `.gitignore` when resolving files
Optionally skip files ignored by git during a scan, in addition to the configured
`exclude` globs.
- Touch: `src/core/scan.ts` (file resolution).

### 10. Document each rule's false-positive guidance
Expand [`docs/rules.md`](./rules.md) with a "When this is a false positive" note per
rule, mirroring the guards in the detector tests.
