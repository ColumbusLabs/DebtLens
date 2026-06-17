# Rule packs

DebtLens is a **maintainability scanner** for TypeScript and JavaScript codebases. React
and React Native are the first serious rule targets — not the identity of the tool.

The product splits into layers:

1. **Core scanner** — file resolution, AST parsing, baselines, `--changed` / `--staged`,
   reporters, config, CI, and GitHub Action integration.
2. **Core rules** — detectors that apply to most TS/JS projects regardless of UI framework.
3. **Framework packs** — optional rule groups and tuning for React, React Native, Next.js,
   Expo, Node APIs, monorepos, and (later) Vue, Svelte, and other ecosystems.

Today all built-in rules run together by default. Select a pack in config or use
`debtlens init --pack <name>` to opt into a preset. Explicit `rules` in config or
`--rules` on the CLI override the pack. Organization policy packages can layer plugins
and presets on top of these built-ins; see [`policy-packages.md`](./policy-packages.md).

## Current built-in rules

| Rule | Pack | What it catches | Default severity |
| --- | --- | --- | --- |
| `duplicate-logic` | **core** | Near-duplicate functions/components using normalized AST/text similarity | Medium |
| `test-duplication` | **core** | Structurally identical test cases across test files | Medium |
| `large-function` | **core** | Non-component functions over line or branch budgets | Medium |
| `complex-control-flow` | **core** | Branch-heavy or deeply nested functions | Medium |
| `import-cycle` | **core** | Circular relative import graphs | Medium |
| `config-drift` | **core** | Conflicting repeated values across JSON config files | Medium |
| `dead-abstraction` | **core** | Thin wrappers that add little behavior | Low |
| `duplicated-literal` | **core** | Repeated string/number literals across files | Low |
| `todo-comment` | **core** | TODO/FIXME/HACK/temporary implementation comments | Low |
| `naming-drift` | **core** | Files with multiple competing names for the same domain concept | Info |
| `barrel-file` | **core** | Re-export-only barrels that obscure import graphs | Low |
| `weak-test-boundary` | **core** | Production imports from test-only modules | Medium |
| `api-surface-sprawl` | **core** | Files exporting too many public symbols | Medium |
| `large-component` | **react** | React-style components with too many lines, hooks, or branch points | Medium |
| `state-sprawl` | **react** | Components/hooks with many local stateful hooks | Medium |
| `effect-complexity` | **react** | Long or overloaded React effect hooks | Medium |
| `hook-dependency-smell` | **react** | Inline object/array/function literals in hook dependency arrays | Low |
| `context-provider-sprawl` | **react** | Components wrapping many unrelated Context providers | Medium |
| `prop-drilling` | **react** | Components that forward many props to children | Medium |
| `story-only-component` | **react** | Exported components whose known consumers are only Storybook stories | Low |
| `rn-host-forwarding` | **react-native** | RN wrappers forwarding many props into host primitives | Medium |
| `server-client-boundary` | **next** | Next App Router server/client boundary mistakes | High |
| `route-handler-size` | **next** | Oversized Next route/page modules | Medium |
| `data-loader-sprawl` | **next** | Server loaders/components with many fetches or awaits | Medium |
| `handler-depth` | **node** | Deeply nested Express/Fastify handlers | Medium |
| `route-sprawl` | **node** | Route modules registering too many endpoints | Medium |

### Core rules

These apply to any TypeScript or JavaScript codebase:

- **`duplicate-logic`** — copy-paste drift, parallel implementations, AI-generated twins.
- **`test-duplication`** — copied test bodies that should become helpers or table-driven cases.
- **`large-function`** — non-component functions that hide multiple responsibilities.
- **`complex-control-flow`** — branch-heavy functions that need policy extraction.
- **`import-cycle`** — relative import cycles that blur module ownership.
- **`config-drift`** — conflicting JSON config values in package and TypeScript config files.
- **`dead-abstraction`** — one-line wrappers and pass-through helpers that add indirection without value.
- **`duplicated-literal`** — repeated domain literals that should often become named constants.
- **`todo-comment`** — deferred work and temporary hacks left in source.
- **`naming-drift`** — inconsistent domain vocabulary within a file or module.
- **`barrel-file`** — wide re-export-only files that hide local import graph shape.
- **`weak-test-boundary`** — production code importing from test-only fixtures or mocks.
- **`api-surface-sprawl`** — files with too many public exports.

Future core rules may expand these signals into language-specific packs or richer project graph analysis.

### React pack (shipped today)

These rules assume React component and hook patterns:

- **`large-component`**
- **`state-sprawl`**
- **`effect-complexity`**
- **`hook-dependency-smell`**
- **`context-provider-sprawl`**
- **`prop-drilling`**
- **`story-only-component`**

React Native and Expo use the React pack plus `rn-host-forwarding`, with slightly looser defaults for prop/provider forwarding and RN host primitive passthrough.

### Next.js pack (shipped today)

The `next` pack combines React rules with App Router and route-module checks:

- **`server-client-boundary`**
- **`route-handler-size`**
- **`data-loader-sprawl`**

### Node pack (shipped today)

The `node` pack combines core rules with route ownership checks:

- **`handler-depth`**
- **`route-sprawl`**

### Maintainer packs

- **`ai-assisted-maintainer`** combines high-signal duplication, literal, function-size, wrapper, TODO, naming, and test-boundary signals. It is about maintainability review only; it does not claim to detect AI-generated authorship.
- **`oss-maintainer`** focuses on library health: public API size, barrels, duplicate exports/logic, test-boundary leaks, and deferred TODO debt.

## Planned framework packs

| Pack | Focus | Status |
| --- | --- | --- |
| `react` | Components, hooks, props, effects, providers, and Storybook usage | **Shipped** |
| `react-native` | RN host components, platform UI patterns | **Shipped** (React pack plus RN host forwarding) |
| `next` | App Router boundaries, server/client splits, data loading | **Shipped** (React pack plus Next-specific rules) |
| `node` | Express/Fastify handlers, middleware depth, route sprawl | **Shipped** |
| `expo` | Expo Router and RN app shell boundaries | **Shipped** (React Native tuning plus barrel tolerance) |
| `ai-assisted-maintainer` | Maintainability signals common in assistant-heavy codebases | **Shipped** |
| `oss-maintainer` | Public API and package-maintainer signals | **Shipped** |
| `monorepo` | `--package` for single-level npm workspaces (`packages/*`); per-package configs planned | Partial ([#23](https://github.com/ColumbusLabs/DebtLens/issues/23)) |

Vue and Svelte are planned JS framework packs. See [`language-pack-rfc.md`](./language-pack-rfc.md)
for the Vue parser recommendation and [`ROADMAP.md`](../ROADMAP.md) for sequencing.

## Future language packs

TypeScript and JavaScript are the **first language**. Detection is language-specific; reporting,
baselines, CI, and the issue contract are not. Future languages plug in via a language pack
and (eventually) the plugin API ([#26](https://github.com/ColumbusLabs/DebtLens/issues/26)).

| Language | Core rules (examples) | Optional UI / framework packs | Status |
| --- | --- | --- | --- |
| **Python** | duplicate logic, dead abstractions, TODO debt, naming drift | Django/Flask route sprawl (TBD) | Parser recommendation documented; fixture in `examples/python/` |
| **Swift** | duplicate logic, large types/functions, dead abstractions, TODO debt | SwiftUI (oversized views, state sprawl), UIKit (large view controllers) | Direction |
| **Kotlin** | same core patterns as Swift row | Jetpack Compose, Android UI layers | Direction |

Each language needs its own parser/AST path (today the scanner uses `ts-morph` for TS/JS
only). Rules that map well across languages — duplication, thin wrappers, deferred TODOs,
naming inconsistency — ship first; framework-specific packs follow once core coverage is
solid. The current parser evaluation is captured in [`language-pack-rfc.md`](./language-pack-rfc.md).

These are intentional direction items, not near-term commitments. Discuss proposals in
[GitHub Discussions](https://github.com/ColumbusLabs/DebtLens/discussions) or open a
**Rule pack request** issue for a new language or framework pack.

## Language-agnostic reporting

Even when detection starts in TypeScript, the output layer is ecosystem-neutral:

| Capability | Formats / flags |
| --- | --- |
| Local review | terminal, Markdown |
| CI gates | `--fail-on`, `--min-severity`, `--baseline` |
| Pull requests | `--changed`, `--staged`, `pr-comment` format |
| Code scanning | SARIF 2.1.0 |
| Integrations | JSON `ScanResult` contract |

Every finding uses the same shape: stable rule `id`, `severity`, `confidence`, file/line,
`evidence`, and `suggestion`. New packs should emit issues in this contract so reporters
and CI do not need to change.

## Scanning only what you need

You can also filter rules explicitly with `--rules`:

```bash
# Core maintainability rules only (no React-specific checks)
debtlens scan --pack core

# React-focused subset
debtlens scan --rules large-component,state-sprawl,effect-complexity,prop-drilling

# Next.js App Router preset
debtlens scan --pack next

# Node API preset
debtlens scan --pack node

# Library-maintainer preset
debtlens scan --pack oss-maintainer
```

List all rule ids with `debtlens rules`.

## Contributing by layer

| Layer | Good for | Examples |
| --- | --- | --- |
| **Core rule** | Any TS/JS project | `duplicate-logic`, `large-function`, `import-cycle`, `config-drift` |
| **React pack** | UI maintainability | extend `large-component`, hook/provider rules |
| **Framework pack** | Next.js, RN, Node APIs | server/client boundary rule, route handler size |
| **Language pack** | Swift, Python, Kotlin, … | duplicate logic, large modules, SwiftUI view size |
| **Scanner / CI** | All adopters | baselines, monorepo `--changed`, Action inputs |
| **Reporter** | All adopters | compact CI summary, stable JSON contract tests |

Start with [`good-first-issues.md`](./good-first-issues.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md).

### Issue templates

- **Rule idea** — new or improved detector (pick core vs pack in the form).
- **Rule pack request** — propose a new optional framework or domain pack.
- **Feature request** — CLI, config, reporters, Action, baselines.
- **Rule false positive** — a finding that should not fire.

Open-ended design discussion belongs in [GitHub Discussions](https://github.com/ColumbusLabs/DebtLens/discussions).
