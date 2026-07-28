# Good first issues

Scoped, self-contained tasks for new contributors. Each entry links to a tracked GitHub
issue with acceptance criteria. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for setup and
[`docs/rule-packs.md`](./rule-packs.md) for **core rules**, **framework packs**, and
contribution layers.

**Labels:** `good first issue` (general) · `good-first-rule` (detector/rule work)

## Active starter board

The labeled queues on GitHub are the source of truth for what is open right now. The
tables in this section are a snapshot taken on 2026-07-28 to save you a search; if a row
disagrees with GitHub, GitHub wins. Check the live
[`good first issue`](https://github.com/ColumbusLabs/DebtLens/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
and [`good-first-rule`](https://github.com/ColumbusLabs/DebtLens/issues?q=is%3Aissue+is%3Aopen+label%3Agood-first-rule)
queues before you start, and comment on the issue so two people do not pick up the same
task.

### Open general starter issues

Labeled `good first issue`. The `difficulty: small` rows are the best place to start if
this is your first PR here.

| Issue | Area | Difficulty |
| --- | --- | --- |
| [#275 Sync `ROADMAP.md` with shipped 0.4+ language packs and Unreleased features](https://github.com/ColumbusLabs/DebtLens/issues/275) | docs | small |
| [#276 Fix `when-not-to-use.md`: Ruby and Swift packs already ship](https://github.com/ColumbusLabs/DebtLens/issues/276) | docs | small |
| [#277 Clarify monorepo pack status after closed #23](https://github.com/ColumbusLabs/DebtLens/issues/277) | docs, config | small |
| [#303 Agent playbook: fix this PR's new debt (MCP + CLI recipe)](https://github.com/ColumbusLabs/DebtLens/issues/303) | docs, adoption | small |
| [#307 Official pre-commit / Lefthook / Husky recipe for `--staged`](https://github.com/ColumbusLabs/DebtLens/issues/307) | docs, adoption | small |
| [#306 Keep GitLab/Azure/Bitbucket CI templates in sync with Action inputs](https://github.com/ColumbusLabs/DebtLens/issues/306) | docs, github-action | medium |
| [#332 Systematize famous-repo showcase scans as living docs](https://github.com/ColumbusLabs/DebtLens/issues/332) | docs, adoption | medium |
| [#333 HTML report accessibility and dark/print polish](https://github.com/ColumbusLabs/DebtLens/issues/333) | reporter | medium |

### Open rule and detector starter issues

Labeled `good-first-rule`. Read [`docs/rule-packs.md`](./rule-packs.md) first so the new
rule lands in the right layer, and expect to ship a positive fixture, a near-miss fixture,
and a detector test with any rule change.

| Issue | Difficulty |
| --- | --- |
| [#284 Deepen python-web: Django CBV and URLConf alias resolution](https://github.com/ColumbusLabs/DebtLens/issues/284) | medium |
| [#309 TypeScript escape-hatch debt rule (`any`, `ts-ignore`, non-null assertions)](https://github.com/ColumbusLabs/DebtLens/issues/309) | medium |
| [#310 Deprecated API usage cluster detector](https://github.com/ColumbusLabs/DebtLens/issues/310) | medium |
| [#313 Generated-code leakage detector](https://github.com/ColumbusLabs/DebtLens/issues/313) | medium |
| [#317 GraphQL resolver and schema sprawl rules](https://github.com/ColumbusLabs/DebtLens/issues/317) | medium |
| [#321 Expo Router and deep-linking debt rules](https://github.com/ColumbusLabs/DebtLens/issues/321) | medium |
| [#282 UIKit pack: large view controllers and UIKit sprawl](https://github.com/ColumbusLabs/DebtLens/issues/282) | large |
| [#283 Deepen Rails pack beyond route/controller sprawl](https://github.com/ColumbusLabs/DebtLens/issues/283) | large |
| [#289 Cross-language parity for newer core smells](https://github.com/ColumbusLabs/DebtLens/issues/289) | large |
| [#311 Test quality pack (assertion-free tests, snapshot sprawl, giant `beforeEach`)](https://github.com/ColumbusLabs/DebtLens/issues/311) | large |

### What a good starter PR looks like

Whichever issue you pick, the review goes faster when the PR carries its own evidence.

| Track | Good starter shape | Evidence to include |
| --- | --- | --- |
| Contributor docs | Refresh an outdated guide, broken link, or missing cross-link. | Before/after doc links and a quick `rg` proving stale wording is gone. |
| Issue templates | Add fields that capture language, command, config, artifacts, or reporter surface. | Parsed template YAML and screenshots or field descriptions if needed. |
| Report examples | Add a small output snippet or fixture command for one report format. | Command, expected output excerpt, and reason the format is useful. |
| Python rules | Add one fixture or one conservative detector improvement. | A positive example, a near-miss, and a targeted detector test. |
| Reporter snapshots | Improve Markdown, PR comment, SARIF, HTML, JUnit, or JSON coverage. | Snapshot or contract test plus the generated command. |

If no listed issue fits, use the
[rule idea template](../.github/ISSUE_TEMPLATE/rule_idea.yml), the
[false-positive template](../.github/ISSUE_TEMPLATE/rule_false_positive.yml), or
[Discussions](https://github.com/ColumbusLabs/DebtLens/discussions) before starting a
broad implementation.

## Historical roadmap status (v0.3.0)

Everything from here down is history, kept so the closed issues stay searchable. It is not
the current queue: for open work use the [active starter board](#active-starter-board)
above, or the labeled queues on GitHub.

The original contributor roadmap batch is **complete**. There are no open good-first
implementation issues from that batch. **Done** means the GitHub issue is closed.

## Core rules (any TS/JS project)

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 3 | Reduce `naming-drift` false positives on domain-rich apps | [#3](https://github.com/ColumbusLabs/DebtLens/issues/3) | **Done** |
| 4 | Configurable markers for `todo-comment` | [#4](https://github.com/ColumbusLabs/DebtLens/issues/4) | **Done** |
| 27 | Warn when `duplicate-logic` hits `maxSnippets` cap | [#27](https://github.com/ColumbusLabs/DebtLens/issues/27) | **Done** |

## React pack rules

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 1 | Make the `prop-drilling` host-component list configurable | [#1](https://github.com/ColumbusLabs/DebtLens/issues/1) | **Done** |
| 2 | Teach `large-component` to recognize `memo`, `forwardRef`, and class components | [#2](https://github.com/ColumbusLabs/DebtLens/issues/2) | **Done** |
| 15 | Extend `effect-complexity` to `useLayoutEffect` / `useInsertionEffect` | [#15](https://github.com/ColumbusLabs/DebtLens/issues/15) | **Done** |

### 1. Make the `prop-drilling` host-component list configurable — [#1](https://github.com/ColumbusLabs/DebtLens/issues/1) (closed)

Implemented via `propDrilling.ignoreComponents`, config/schema support, and detector
tests covering custom ignored components.

### 2. Teach `large-component` to recognize more component forms — [#2](https://github.com/ColumbusLabs/DebtLens/issues/2) (closed)

`memo`, `forwardRef`, and class components are classified in
[`src/utils/ast.ts`](../src/utils/ast.ts) with fixtures in
`tests/detectors/largeComponent.test.ts`.

### 3. Reduce `naming-drift` false positives on domain-rich apps — [#3](https://github.com/ColumbusLabs/DebtLens/issues/3) (closed)

`namingDrift.disableBuiltInVocabulary` and calibrated media fixtures reduce noise on
domain-rich apps. See [`src/detectors/namingDrift.ts`](../src/detectors/namingDrift.ts).

### 4. Configurable markers for `todo-comment` — [#4](https://github.com/ColumbusLabs/DebtLens/issues/4) (closed)

Custom markers, disabled defaults, and `replaceDefaults` are supported via config and
documented in the schema. See [`src/detectors/todoComment.ts`](../src/detectors/todoComment.ts).

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

## Adoption and CI (v0.3)

| # | Task | Issue | Status |
| --- | --- | --- | --- |
| 23 | Monorepo and package-aware scanning | [#23](https://github.com/ColumbusLabs/DebtLens/issues/23) | **Done** |
| 33 | Inline suppressions with required reasons | [#33](https://github.com/ColumbusLabs/DebtLens/issues/33) | **Done** |
| 37 | `debtlens doctor` for config debugging | [#37](https://github.com/ColumbusLabs/DebtLens/issues/37) | **Done** |
| 38 | First-run adoption wizard | [#38](https://github.com/ColumbusLabs/DebtLens/issues/38) | **Done** |
| 39 | Confidence-aware exit-code policy | [#39](https://github.com/ColumbusLabs/DebtLens/issues/39) | **Done** |

## Forward-looking work

Multi-PR or RFC efforts for future releases:

| # | Task | Layer | Issue | Status |
| --- | --- | --- | --- | --- |
| 26 | Plugin API for third-party rules | scanner / extensibility | [#26](https://github.com/ColumbusLabs/DebtLens/issues/26) | RFC closed — see [`docs/plugin-api-rfc.md`](./plugin-api-rfc.md) |
