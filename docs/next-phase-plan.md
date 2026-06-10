# Next Phase Plan: Plugin API + CLI Quick Wins

Status: **Implemented** — all eight issues landed on this branch as five sequential
commits matching the PR breakdown below.
Date: 2026-06-10

## Context

v0.3 ("Maintainer workflow integrations") is shipped. Per [`ROADMAP.md`](../ROADMAP.md),
the headline item for v0.4 is the **plugin API for third-party rules**, which already has
an accepted design in [`docs/plugin-api-rfc.md`](./plugin-api-rfc.md) but no implementation:
`plugins` and `pluginApiVersion` do not exist yet in the config schema, and all detectors
are hardcoded in [`src/detectors/index.ts`](../src/detectors/index.ts).

This plan selects **eight open issues** in two tracks: the plugin API vertical (five
issues that together ship the RFC end to end) and three small, independent CLI/config
quick wins that improve day-to-day DX while the larger work lands.

## Selected issues

### Track A — Plugin API (roadmap v0.4 centerpiece)

| Order | Issue | Title | Difficulty |
| --- | --- | --- | --- |
| A1 | [#69](https://github.com/ColumbusLabs/DebtLens/issues/69) | Add `pluginApiVersion` to config schema and runtime validation | Small |
| A2 | [#68](https://github.com/ColumbusLabs/DebtLens/issues/68) | Implement plugin loader prototype | Large |
| A3 | [#71](https://github.com/ColumbusLabs/DebtLens/issues/71) | Add `DEBTLENS_DISABLE_PLUGINS` CI escape hatch | Small |
| A4 | [#72](https://github.com/ColumbusLabs/DebtLens/issues/72) | Add example plugin repo fixture and integration test | Medium |
| A5 | [#70](https://github.com/ColumbusLabs/DebtLens/issues/70) | Export `debtlens/plugin` TypeScript types entry point | Medium |

**Why this cluster:** these five issues are mutually dependent slices of one feature, all
labeled `type: rfc`, and the RFC resolves every design question in advance (config shape,
loading model, versioning, security constraints). Shipping them together moves the roadmap's
single biggest v0.4 commitment from "designed" to "done" and unblocks the follow-on plugin
issues (#73 plugin thresholds, #74 plugin vocabulary, #165 policy packs).

### Track B — CLI/config quick wins (independent, low risk)

| Order | Issue | Title | Difficulty |
| --- | --- | --- | --- |
| B1 | [#151](https://github.com/ColumbusLabs/DebtLens/issues/151) | Suggest did-you-mean for unknown rule ids | Small |
| B2 | [#145](https://github.com/ColumbusLabs/DebtLens/issues/145) | Add `debtlens explain` command for rule documentation | Small |
| B3 | [#106](https://github.com/ColumbusLabs/DebtLens/issues/106) | Add `failOn` severity to config file | Small |

**Why these:** all three are `good first issue`-class, touch isolated code paths, and
two of them (#151, #145) become more valuable once plugins exist — did-you-mean and
`explain` should operate over the merged (built-in + plugin) registry, so building them
in the same phase keeps the registry abstraction honest.

**Deliberately deferred:** performance work (#138–#142) until the plugin loader settles the
detector registry shape; Python pack (#92–#96) since it depends on the language-pack
interface spike; new core rules (#85–#91) which are independent and parallelizable by
other contributors.

## Execution plan

### A1 — `pluginApiVersion` (#69)

- Add `pluginApiVersion` (integer) and `plugins` (string array) to the JSON schema in
  [`src/config/schema.ts`](../src/config/schema.ts) and to `DebtLensConfig` in
  [`src/config/loadConfig.ts`](../src/config/loadConfig.ts).
- Export `DEBTLENS_PLUGIN_API_VERSION = 1` constant from a new `src/plugins/version.ts`.
- Validate at config load: mismatch throws with an upgrade message naming both versions.
- Update the schema drift test (`tests/config/schema.test.ts`) and CHANGELOG with the bump policy.

### A2 — Plugin loader (#68)

- New `src/plugins/loadPlugins.ts`:
  - Resolve each `plugins[]` path relative to the config file directory; reject paths
    escaping the repo root (per RFC security section).
  - Dynamic `import()` of ESM modules; accept default export of a single `Detector` or
    `{ rules: Detector[], vocabulary? }`.
  - Validate detector shape (id, name, description, defaultSeverity, tags, detect) and
    error on id collisions with built-ins or other plugins.
- Merge plugin detectors into the registry consumed by `scan()` in
  [`src/core/scan.ts`](../src/core/scan.ts); explicit `rules` selection works unchanged.
- Tests: happy path, invalid export shape, id collision, path traversal rejection
  (`tests/core/scan.test.ts`, new `tests/plugins/loadPlugins.test.ts`).

### A3 — `DEBTLENS_DISABLE_PLUGINS` (#71)

- In the loader entry point: when env var is `1`, skip loading and emit one stderr note
  if `plugins` is configured. Built-in rules unaffected.
- Document in `SECURITY.md` and the RFC (the RFC already reserves this flag).
- CLI test asserting scan succeeds with plugins configured but disabled.

### A4 — Example plugin + integration test (#72)

- Add `examples/plugin/no-console.mjs` (the RFC's minimal example) plus a sample
  `debtlens.config.json` enabling it.
- Integration test scans a small fixture and asserts the plugin finding appears in JSON
  output; wire into the default `npm test` run.
- Link the example from the RFC and README.

### A5 — `debtlens/plugin` types entry (#70)

- Add a `./plugin` subpath export in `package.json` exposing `Detector`,
  `DetectorContext`, `DebtIssue`, and `Severity` from [`src/core/types.ts`](../src/core/types.ts).
- Convert the example plugin (or add a sibling) to a type-checked `.ts` variant that
  imports only from the published entry; verify with `npm run typecheck`.
- Document in the RFC and README.

### B1 — Did-you-mean for rule ids (#151)

- Small Levenshtein helper in `src/utils/` (no new dependency).
- Apply where `--rules`, config `rules`, and suppression directives reject unknown ids
  (CLI parse in [`src/cli/index.ts`](../src/cli/index.ts),
  [`src/core/suppressions.ts`](../src/core/suppressions.ts)).
- Match against the merged registry ids so plugin rules are suggested too.
- Acceptance: `todo-comments` suggests `todo-comment` (`tests/cli/`).

### B2 — `debtlens explain` (#145)

- New `explain <rule-id>` command in [`src/cli/index.ts`](../src/cli/index.ts) rendering
  the matching section of [`docs/rules.md`](./rules.md) plus default severity, tags, and
  thresholds from the detector registry.
- Unknown rule id exits non-zero and reuses the B1 did-you-mean helper.
- Tests in `tests/cli/`.

### B3 — `failOn` in config (#106)

- Add `failOn` to the config schema and `mergeConfig` precedence
  ([`src/config/mergeConfig.ts`](../src/config/mergeConfig.ts)): CLI `--fail-on` overrides
  config value, matching the existing `failOnConfidence` pattern.
- Tests: config-only `failOn` gates exit code (`tests/cli/scan.test.ts`); schema drift
  test updated (`tests/config/schema.test.ts`).

## Sequencing and PR breakdown

```
PR 1: B1 + B2  (did-you-mean helper, explain command — explain reuses the helper)
PR 2: B3       (failOn config — isolated)
PR 3: A1       (schema + version constant — small, reviewable alone)
PR 4: A2 + A3  (loader + escape hatch — the escape hatch is part of the loader's entry)
PR 5: A4 + A5  (example plugin + types entry — the typed example validates the entry point)
```

Tracks A and B are independent; PRs 1–3 can land in any order. PR 4 depends on PR 3,
and PR 5 depends on PR 4.

## Validation

- `npm test` (full suite) on every PR; targeted suites per issue's stated test command.
- `npm run typecheck` for PR 5.
- Schema drift tests guard config changes in PRs 2–3.
- The calibration fixtures (`tests/fixtures/quality/`) guard against detector behavior
  drift — no detector logic changes in this phase, so counts must stay identical.

## Definition of done

- All eight issues closed with tests matching their stated acceptance criteria.
- Plugin RFC status updated from Draft to Shipped, with follow-ons (#73, #74, #165) noted.
- CHANGELOG entries for the plugin API (with `pluginApiVersion` bump policy), `explain`,
  did-you-mean, and config `failOn`.
