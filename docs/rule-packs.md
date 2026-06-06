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
`--rules` on the CLI override the pack.

## Current built-in rules

| Rule | Pack | What it catches | Default severity |
| --- | --- | --- | --- |
| `duplicate-logic` | **core** | Near-duplicate functions/components using normalized AST/text similarity | Medium |
| `dead-abstraction` | **core** | Thin wrappers that add little behavior | Low |
| `todo-comment` | **core** | TODO/FIXME/HACK/temporary implementation comments | Low |
| `naming-drift` | **core** | Files with multiple competing names for the same domain concept | Info |
| `large-component` | **react** | React-style components with too many lines, hooks, or branch points | Medium |
| `state-sprawl` | **react** | Components/hooks with many local stateful hooks | Medium |
| `effect-complexity` | **react** | Long or overloaded React effect hooks | Medium |
| `prop-drilling` | **react** | Components that forward many props to children | Medium |

### Core rules

These apply to any TypeScript or JavaScript codebase:

- **`duplicate-logic`** — copy-paste drift, parallel implementations, AI-generated twins.
- **`dead-abstraction`** — one-line wrappers and pass-through helpers that add indirection without value.
- **`todo-comment`** — deferred work and temporary hacks left in source.
- **`naming-drift`** — inconsistent domain vocabulary within a file or module.

Future core rules might cover large functions/modules, complex control flow, duplicated
literals, import tangles, weak test boundaries, and config drift.

### React pack (shipped today)

These rules assume React component and hook patterns:

- **`large-component`**
- **`state-sprawl`**
- **`effect-complexity`**
- **`prop-drilling`**

React Native uses the same pack. RN-specific tuning (host components, platform primitives)
lives in detector configuration — for example `propDrilling.ignoreComponents` — not in
separate rule IDs yet.

## Planned framework packs

| Pack | Focus | Status |
| --- | --- | --- |
| `react` | Components, hooks, props, effects | **Shipped** (four rules above) |
| `react-native` | RN host components, platform UI patterns | Partial (config tuning; dedicated rules TBD) |
| `next` | App Router boundaries, server/client splits, data loading | Planned |
| `node` | Express/Fastify handlers, middleware depth, route sprawl | Planned |
| `expo` | Expo config and module boundaries | Planned |
| `monorepo` | Per-package configs, workspace-aware `--changed` | Planned ([#23](https://github.com/ColumbusLabs/DebtLens/issues/23)) |

Vue and Svelte are planned JS framework packs. See [`ROADMAP.md`](../ROADMAP.md).

## Future language packs

TypeScript and JavaScript are the **first language**. Detection is language-specific; reporting,
baselines, CI, and the issue contract are not. Future languages plug in via a language pack
and (eventually) the plugin API ([#26](https://github.com/ColumbusLabs/DebtLens/issues/26)).

| Language | Core rules (examples) | Optional UI / framework packs | Status |
| --- | --- | --- | --- |
| **Python** | duplicate logic, dead abstractions, TODO debt, naming drift | Django/Flask route sprawl (TBD) | Roadmap v0.4 |
| **Swift** | duplicate logic, large types/functions, dead abstractions, TODO debt | SwiftUI (oversized views, state sprawl), UIKit (large view controllers) | Direction |
| **Kotlin** | same core patterns as Swift row | Jetpack Compose, Android UI layers | Direction |

Each language needs its own parser/AST path (today the scanner uses `ts-morph` for TS/JS
only). Rules that map well across languages — duplication, thin wrappers, deferred TODOs,
naming inconsistency — ship first; framework-specific packs follow once core coverage is
solid.

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
debtlens scan --rules duplicate-logic,dead-abstraction,todo-comment,naming-drift

# React-focused subset
debtlens scan --rules large-component,state-sprawl,effect-complexity,prop-drilling
```

List all rule ids with `debtlens rules`.

## Contributing by layer

| Layer | Good for | Examples |
| --- | --- | --- |
| **Core rule** | Any TS/JS project | `duplicate-logic`, import-cycle detector |
| **React pack** | UI maintainability | extend `large-component`, new hook rules |
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
