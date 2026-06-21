# Rule packs

DebtLens is a **maintainability scanner** for TypeScript, JavaScript, Python, Vue/Svelte SFC scripts, Kotlin, Swift, Ruby, and Jetpack Compose
codebases. React and React Native were the first serious framework targets, but the
scanner identity is the shared maintainability contract, not a single UI stack.

The product splits into layers:

1. **Core scanner** — file resolution, AST parsing, baselines, `--changed` / `--staged`,
   reporters, config, CI, and GitHub Action integration.
2. **Core rules** — detectors that apply to most TS/JS projects regardless of UI framework.
3. **Framework and language packs** — optional rule groups and tuning for React, React
   Native, Next.js, Expo, Node APIs, Python, Python web apps, Vue/Svelte SFC scripts, Kotlin, Jetpack Compose, and monorepos. Additional ecosystems
   such as Swift and Ruby follow the same model.

Today all TS/JS built-in rules run together by default, while non-TS/JS discovery is
driven by language metadata on built-in packs and detectors. Select a pack in config
or use `debtlens init --pack <name>` to opt into a preset. Explicit `rules` in config
or `--rules` on the CLI override the pack but still use detector language metadata for
default discovery. Organization policy packages can layer plugins and presets on top of
these built-ins; see [`policy-packages.md`](./policy-packages.md).
For a user-facing selection table, see [`pack-chooser.md`](./pack-chooser.md).

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
| `python-duplicate-logic` | **python** | Near-duplicate Python functions using normalized function-body similarity | Medium |
| `python-large-function` | **python** | Python functions over line or branch-count budgets | Medium |
| `python-complex-control-flow` | **python** | Branch-heavy or deeply nested Python functions | Medium |
| `python-dead-abstraction` | **python** | Thin Python functions that only pass arguments through | Low |
| `python-todo-comment` | **python** | TODO/FIXME/HACK/temporary implementation comments in Python files | Low |
| `python-route-sprawl` | **python-web** | Flask/Blueprint or Django URL modules registering too many routes | Medium |
| `vue-todo-comment` | **vue** | TODO/FIXME/HACK/temporary comments inside Vue SFC script blocks | Low |
| `vue-large-script` | **vue** | Oversized Vue SFC scripts or script functions | Medium |
| `vue-duplicate-logic` | **vue** | Near-duplicate Vue SFC script functions | Medium |
| `svelte-todo-comment` | **svelte** | TODO/FIXME/HACK/temporary comments inside Svelte component script blocks | Low |
| `svelte-large-script` | **svelte** | Oversized Svelte component scripts or script functions | Medium |
| `svelte-duplicate-logic` | **svelte** | Near-duplicate Svelte component script functions | Medium |
| `kotlin-duplicate-logic` | **kotlin** | Near-duplicate Kotlin functions using normalized function-body similarity | Medium |
| `kotlin-large-function` | **kotlin** | Kotlin functions over line or branch-count budgets | Medium |
| `kotlin-dead-abstraction` | **kotlin** | Thin Kotlin functions that only pass arguments through | Low |
| `kotlin-todo-comment` | **kotlin** | TODO/FIXME/HACK/temporary implementation comments in Kotlin files | Low |
| `swift-duplicate-logic` | **swift** | Near-duplicate Swift functions using normalized function-body similarity | Medium |
| `swift-large-function` | **swift** | Swift functions over line or branch-count budgets | Medium |
| `swift-dead-abstraction` | **swift** | Thin Swift functions that only pass arguments through | Low |
| `swift-todo-comment` | **swift** | TODO/FIXME/HACK/temporary implementation comments in Swift files | Low |
| `swiftui-large-view` | **swiftui** | Oversized or branch-heavy SwiftUI `View` bodies | Medium |
| `swiftui-state-sprawl` | **swiftui** | SwiftUI views with many local property-wrapper state holders | Medium |
| `ruby-duplicate-logic` | **ruby** | Near-duplicate Ruby methods using normalized method-body similarity | Medium |
| `ruby-large-function` | **ruby** | Ruby methods over line or branch-count budgets | Medium |
| `ruby-dead-abstraction` | **ruby** | Thin Ruby methods that only pass arguments through | Low |
| `ruby-todo-comment` | **ruby** | TODO/FIXME/HACK/temporary implementation comments in Ruby files | Low |
| `rails-route-sprawl` | **rails** | Rails `routes.rb` modules registering too many routes | Medium |
| `rails-controller-sprawl` | **rails** | Rails controllers with too many public actions | Medium |
| `compose-large-composable` | **compose** | Oversized or branch-heavy Jetpack Compose functions | Medium |
| `compose-state-hoisting` | **compose** | Composables that own many local state holders instead of hoisting state | Medium |

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

### Python pack (shipped today)

The `python` pack declares the Python language in pack metadata, which widens discovery
to `.py` files and emits the same `ScanResult` shape as TS/JS rules:

- **`python-duplicate-logic`**
- **`python-large-function`**
- **`python-complex-control-flow`**
- **`python-dead-abstraction`**
- **`python-todo-comment`**

Use `--pack core,python` when one scan should cover both TS/JS and Python paths.
Python function-based rules use a stdlib-`ast` sidecar when `python3` or `python` is
available, then fall back to conservative text parsing with a scan warning.

### Python web pack (shipped today)

The `python-web` pack combines core Python rules with route ownership checks for common
Flask, Blueprint, and Django URL module shapes:

- **`python-route-sprawl`**

Use `--pack python-web` for Python web services. It includes the core Python rules from
`python`; use explicit `--rules python-route-sprawl` if you only want the route-count
check. Django URLConf route counting is conservative; class-based view resolution and
import alias analysis are out of scope.

### Vue pack (shipped today)

The `vue` pack widens discovery to `.vue` files and scans inline `<script>` and
`<script setup>` blocks by preserving their original `.vue` line positions in a virtual
TS/JS source file:

- **`vue-todo-comment`**
- **`vue-large-script`**
- **`vue-duplicate-logic`**

Use `--pack vue` for Vue single-file components. The MVP intentionally analyzes script
blocks only: template AST debt, directive complexity, scoped-style issues, and external
`<script src="...">` files are out of scope. Combine `--pack core,vue` when the same
scan should include plain `.ts`, `.tsx`, `.js`, or `.jsx` files beside `.vue` components.

### Svelte pack (shipped today)

The `svelte` pack widens discovery to `.svelte` files and scans inline module and
instance `<script>` blocks with original `.svelte` line mapping:

- **`svelte-todo-comment`**
- **`svelte-large-script`**
- **`svelte-duplicate-logic`**

Use `--pack svelte` for component scripts. For SvelteKit projects, combine
`--pack core,svelte` when you also want TypeScript route modules such as `+page.ts`,
`+layout.ts`, `+server.ts`, or shared `.ts` helpers. Markup debt, load-function routing
semantics, and template/control-flow analysis are separate future rules.

### Kotlin pack (shipped today)

The `kotlin` pack declares Kotlin discovery metadata, which widens discovery to `.kt`
and `.kts` files and emits the same `ScanResult` shape as TS/JS rules:

- **`kotlin-duplicate-logic`**
- **`kotlin-large-function`**
- **`kotlin-dead-abstraction`**
- **`kotlin-todo-comment`**

Use `--pack core,python,kotlin` when one scan should cover mixed TS/JS, Python, and
Kotlin paths. Jetpack Compose-specific UI debt lives in the separate `compose` pack.

### Jetpack Compose pack (shipped today)

The `compose` pack is a Kotlin-backed framework pack: it declares Kotlin discovery
metadata, but selects only Compose-specific UI rules rather than generic Kotlin core
rules:

- **`compose-large-composable`**
- **`compose-state-hoisting`**

Use `--pack kotlin,compose` when one scan should cover both core Kotlin maintainability
and Compose UI debt.

### Maintainer packs

- **`ai-assisted-maintainer`** combines high-signal duplication, literal, function-size, wrapper, TODO, naming, and test-boundary signals. It is about maintainability review only; it does not claim to detect AI-generated authorship.
- **`oss-maintainer`** focuses on library health: public API size, barrels, duplicate exports/logic, test-boundary leaks, and deferred TODO debt.

## Pack status matrix

| Pack | Focus | Status |
| --- | --- | --- |
| `react` | Components, hooks, props, effects, providers, and Storybook usage | **Shipped** |
| `react-native` | RN host components, platform UI patterns | **Shipped** (React pack plus RN host forwarding) |
| `next` | App Router boundaries, server/client splits, data loading | **Shipped** (React pack plus Next-specific rules) |
| `node` | Express/Fastify handlers, middleware depth, route sprawl | **Shipped** |
| `python` | Python duplicate functions, large and branch-heavy functions, thin wrappers, and TODO debt | **Shipped** |
| `python-web` | Flask/Blueprint and Django URL route ownership | **Shipped** |
| `vue` | Vue SFC script TODO, large-script, and duplicate-logic signals | **Shipped** |
| `svelte` | Svelte component script TODO, large-script, and duplicate-logic signals | **Shipped** |
| `kotlin` | Kotlin duplicate functions, large functions, thin wrappers, and TODO debt | **Shipped** |
| `swift` | Swift duplicate functions, large functions, thin wrappers, and TODO debt | **Shipped** |
| `swiftui` | SwiftUI oversized views and local state sprawl | **Shipped** |
| `ruby` | Ruby duplicate methods, large methods, thin wrappers, and TODO debt | **Shipped** |
| `rails` | Ruby core rules plus Rails route and controller sprawl | **Shipped** |
| `compose` | Jetpack Compose oversized composables and state-hoisting smells | **Shipped** |
| `expo` | Expo Router and RN app shell boundaries | **Shipped** (React Native tuning plus barrel tolerance) |
| `ai-assisted-maintainer` | Maintainability signals common in assistant-heavy codebases | **Shipped** |
| `oss-maintainer` | Public API and package-maintainer signals | **Shipped** |
| `monorepo` | `--package` for single-level npm workspaces (`packages/*`); per-package configs planned | Partial ([#23](https://github.com/ColumbusLabs/DebtLens/issues/23)) |

## Language packs

Detection is language-specific; reporting, baselines, CI, and the issue contract are not.
Python, Vue/Svelte SFC script, and Kotlin are built-in language or SFC-script packs. Built-in pack metadata
now owns language discovery and extension routing, so future Swift and Ruby
packs can add discovery without editing central scan conditionals. Other languages should
follow the same shared result contract.

| Language | Core rules (examples) | Optional UI / framework packs | Status |
| --- | --- | --- | --- |
| **Python** | duplicate logic, large functions, complex control flow, dead abstractions, TODO debt | Python web (`python-route-sprawl`) | **Shipped** for core Python and Python web route rules |
| **Vue SFC** | script TODOs, large scripts/functions, duplicate script functions | Vue template-specific rules | **Shipped** for script-block MVP |
| **Svelte SFC** | script TODOs, large scripts/functions, duplicate script functions | SvelteKit routing and markup-specific rules | **Shipped** for script-block MVP |
| **Kotlin** | duplicate logic, large functions, dead abstractions, TODO debt | Jetpack Compose (`compose-large-composable`, `compose-state-hoisting`) | **Shipped** for core Kotlin and Compose UI rules |
| **Swift** | duplicate logic, large types/functions, dead abstractions, TODO debt | SwiftUI (oversized views, state sprawl), UIKit (large view controllers) | **Shipped** for core Swift and SwiftUI rules |
| **Ruby** | duplicate logic, large methods, dead abstractions, TODO debt | Rails (`rails-route-sprawl`, `rails-controller-sprawl`) | **Shipped** for core Ruby and Rails framework rules |

Each language needs its own parser/AST path. Rules that map well across languages —
duplication, thin wrappers, deferred TODOs, naming inconsistency — ship first;
framework-specific packs follow once core coverage is solid. Python and Kotlin's current
built-in packs and parser recommendations are captured in [`language-pack-rfc.md`](./language-pack-rfc.md).

Unshipped rows are intentional direction items, not near-term commitments. Discuss proposals in
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

# Python sources
debtlens scan examples/python --pack python

# Python web routes
debtlens scan examples/python-web --pack python-web

# Vue SFC scripts
debtlens scan examples/vue --pack vue

# Svelte component scripts
debtlens scan examples/svelte --pack svelte

# Mixed TS/JS plus Python scan
debtlens scan . --pack core,python,vue,svelte

# Jetpack Compose UI screens
debtlens scan examples/compose --pack compose

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
