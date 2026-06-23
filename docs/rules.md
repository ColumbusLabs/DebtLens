# DebtLens Rules

DebtLens rules are heuristics. They should produce review prompts, not absolute judgments. Every issue includes confidence, evidence, and a suggested maintainer action.

Rules are grouped into **core**, language packs such as **python**, **kotlin**, **swift**, and **ruby**, SFC script packs such as **vue** and **svelte**, and framework packs such as **react**, **next**, **react-native**, **node**, **rails**, and **compose**. See [`rule-packs.md`](./rule-packs.md) for the full taxonomy.

> **Core pack migration:** Recent releases added `import-cycle`, `config-drift`, and `complex-control-flow` to the default **core** pack. Existing configs that pin `rules` or use an older init template may not include them until you re-run `debtlens init` or add the ids manually. `debtlens init --from-eslint` maps ESLint `complexity` / `max-depth` thresholds into `complex-control-flow` when no framework pack is inferred.

## Confidence scoring

Every finding includes a **confidence** score from 0 to 1. Confidence reflects how strongly the evidence supports the finding — it is separate from **severity**, which reflects how costly the debt would be if real.

| Range | Meaning | How to use it |
| --- | --- | --- |
| 0.85–1.0 | Near-certain | Strong signal; prioritize in review or CI gates |
| 0.70–0.84 | Strong | Worth fixing or tracking; usually not a false positive |
| 0.50–0.69 | Advisory | Review context; may be intentional architecture |
| below 0.50 | Weak | Rare in built-in rules; treat as a hint only |

Use confidence for triage and CI policy (for example, `--fail-on high --fail-on-confidence 0.8`) when you want to gate on high-severity findings that are also well-supported.

## Suppressing findings

DebtLens supports three layers for managing noise. Pick the narrowest tool that fits:

| Approach | Best for |
| --- | --- |
| **Config / thresholds** | Project-wide false positives (ignore components, custom TODO markers, naming vocabulary) |
| **Baseline** | Legacy debt you accept today but want to block newly introduced issues in CI |
| **Inline suppression** | Rare, file-local exceptions with an auditable reason |

Inline suppressions use comment directives:

```ts
// debtlens-disable-next-line <rule-id> -- <reason>
// debtlens-disable-file <rule-id> -- <reason>
```

The reason after `--` is required. Unknown rule ids and missing reasons produce warnings and do not suppress. Suppressions run inside `scan()` before baseline or `--diff-base` filtering, so baselines still track only the issues that remain after inline suppressions. JSON output includes accepted suppressions in a root `suppressions` audit array with the rule, file, directive line, reason, and suppressed issue.

Use `debtlens scan --audit-suppressions` to emit a directive-level audit in `suppressionDirectives`. It includes used, unused, and not-evaluated directives, separates file-wide suppressions from next-line suppressions, reports hidden-finding counts, and recommends whether to remove stale suppressions, narrow broad file-wide exceptions, or rerun the audit with an unselected rule enabled.

## `large-component`

Flags React-style PascalCase functions, `memo`/`forwardRef` wrappers, and class components
that extend `Component`/`PureComponent` when they exceed line, hook, or branch thresholds.
Calls to custom hooks defined in the same file are not counted against the component
hook budget; imported hooks and React hooks still count.

Default thresholds:

- `large-component.maxLines`: 250
- `large-component.maxBranches`: 16
- `large-component.maxHooks`: 10

Why it matters: large components often combine rendering, data loading, state coordination, and business rules. AI-assisted edits can make this worse because adding code is easier than preserving boundaries.

Good fixes:

- extract rendering subcomponents
- move derived state to `useMemo`
- move imperative workflows to named hooks
- split independent features behind composition boundaries

When this is a false positive:

- the file is not actually a React-style component
- same-file custom hook delegation accounts for the apparent hook count
- the component stays within the configured line, hook, and branch budgets

Confidence: **0.86** when the line budget is exceeded; **0.74** when only hook or branch budgets are exceeded. Line count is the strongest structural signal.

## `large-function`

Flags non-component functions that exceed line or branch budgets. React-style components are left to `large-component`.

Default thresholds:

- `large-function.maxLines`: 120
- `large-function.maxBranches`: 12

Why it matters: oversized functions hide multiple responsibilities and make review harder because every change has to preserve several phases at once.

Good fixes:

- split phases into named helpers
- move policy tables into data
- isolate validation, normalization, and side effects

When this is a false positive:

- the function is generated or intentionally table-driven
- the logic is a React component already handled by `large-component`

Confidence: **0.76-0.82** depending on whether the line budget, branch budget, or both budgets are exceeded.

## `complex-control-flow`

Flags functions whose branch count or control-flow nesting makes behavior hard to review.

Default thresholds:

- `complex-control-flow.maxComplexity`: 12
- `complex-control-flow.maxDepth`: 4

Why it matters: branch-heavy functions hide policy decisions inside procedural code. Deeply nested switches, loops, catches, and ternaries are especially easy to break during fast edits.

Good fixes:

- replace nested conditionals with guard clauses
- move policy into lookup tables or strategy objects
- extract branch-specific helpers with descriptive names

When this is a false positive:

- the function is intentionally generated or table-driven
- the branch structure mirrors a stable external protocol

Confidence scales with how far the function exceeds the configured complexity or nesting threshold.

## `import-cycle`

Flags circular relative import graphs among scanned TypeScript and JavaScript modules.

Default thresholds:

- `import-cycle.minCycleSize`: 2
- `import-cycle.allowTypeOnly`: 1

Why it matters: import cycles make initialization order and ownership boundaries harder to reason about. They are often a sign that shared contracts need to move down a layer.

Good fixes:

- move shared types or constants into a lower-level module
- invert one dependency through an interface or callback
- split bidirectional modules by responsibility

When this is a false positive:

- the cycle is type-only and `import-cycle.allowTypeOnly` is enabled
- the modules are generated glue code

Type-only imports are ignored by default.

## `config-drift`

Flags conflicting repeated values across JSON config files such as `package.json` scripts and `tsconfig*.json` compiler options. JavaScript config files are not executed.

Why it matters: monorepo config drift makes package behavior unpredictable and causes CI, editor, or build differences that are hard to diagnose.

Good fixes:

- move shared settings into a base config
- document intentional package-specific differences
- align repeated scripts when they are meant to be interchangeable

When this is a false positive:

- packages deliberately use different build systems
- a migration is temporarily running two config styles side by side

Confidence is **0.78** because repeated JSON values are direct evidence, but project intent still matters.

## `test-duplication`

Flags structurally identical test callback bodies across test files. Parameterized tests such as `test.each` are ignored.

Default thresholds:

- `test-duplication.minSimilarity`: 0.88
- `test-duplication.minStructuralSimilarity`: 0.72
- `test-duplication.minLines`: 3

Why it matters: copy-pasted tests often drift apart without strengthening coverage. They can also obscure the small set of scenario variables that actually matter.

Good fixes:

- extract shared test setup helpers
- convert parallel examples into table-driven tests
- keep duplicated tests only when they intentionally protect separate public contracts

When this is a false positive:

- the repeated assertions document separate externally visible behaviors
- the test is already parameterized

Confidence follows normalized text and structural similarity between test bodies.

## `state-sprawl`

Flags components/hooks with many calls to local stateful hooks such as `useState`, `useReducer`, and `useRef`.

Default threshold:

- `state-sprawl.maxStatefulHooks`: 6

Why it matters: many independent state variables usually mean a component is coordinating several workflows. This raises the cost of every future change.

Good fixes:

- consolidate related transitions in a reducer
- extract a domain hook
- move server/cache state into the data layer
- delete unused state before adding new state

When this is a false positive:

- the function is not classified as a component or hook
- the file stays at or below the configured stateful-hook threshold

Confidence: **0.82**. Hook counts are a direct, countable signal with limited ambiguity.

## `effect-complexity`

Flags long, branchy, or overloaded `useEffect`, `useLayoutEffect`, and `useInsertionEffect` calls.

Default thresholds:

- `effect-complexity.maxLines`: 30
- `effect-complexity.maxDependencies`: 8

Why it matters: effects are common hiding places for race conditions, duplicated fetching, stale dependencies, and side effects that should be modeled explicitly.

Good fixes:

- split unrelated effects
- replace derived-state effects with memoized values
- move async workflows into named functions
- use framework data loading where appropriate

When this is a false positive:

- the callback is small and focused
- a many-dependency effect only delegates to a focused custom hook
- the array literal belongs to another API instead of a React effect hook

Confidence: **0.80** for raw overloaded effects; lower when the callback only delegates to a custom hook.

## `hook-dependency-smell`

Flags React hook dependency arrays that contain inline object, array, or function literals.

Why it matters: inline dependency values are recreated each render, so memoization and effects can run more often than the author expects.

Good fixes:

- move inline objects/arrays into `useMemo`
- move inline callbacks into `useCallback`
- depend on primitive inputs instead of aggregate literals

When this is a false positive:

- the hook intentionally re-runs every render
- the dependency array belongs to a custom API with different semantics

Confidence: **0.78**. The syntax is direct, but the runtime cost depends on the hook's role.

## `context-provider-sprawl`

Flags React components that wrap children in many distinct `*.Provider` contexts.

Default threshold:

- `context-provider-sprawl.maxProviders`: 4

Why it matters: provider shells with unrelated concerns become global setup hubs and make app boundaries harder to reason about.

Good fixes:

- split unrelated providers into route or feature boundaries
- colocate context closer to consumers
- group provider values only when they share ownership and lifecycle

When this is a false positive:

- the providers form one deliberate app bootstrap boundary
- the component stays below the configured provider threshold

Confidence: **0.74**. Provider count is objective, but app-shell architecture varies.

## `rn-host-forwarding`

Flags React Native wrapper components that forward many wrapper props into RN host primitives such as `View`, `Pressable`, `FlatList`, `TextInput`, and aliased imports from `react-native`.

Default thresholds:

- `rn-host-forwarding.maxForwardedProps`: 6
- `rn-host-forwarding.maxHostTargets`: 3

Why it matters: RN wrapper components can quietly become wide pass-through APIs where style, accessibility, and event ownership is unclear.

Good fixes:

- narrow the wrapper API to the variants it owns
- split visual variants from interaction wrappers
- let callers own raw host primitives when passthrough is the real purpose

When this is a false positive:

- the component is a deliberate low-level primitive
- rest props are intentionally part of a design-system contract

Confidence: **0.78-0.84** depending on whether broad rest spreading is present.

## `server-client-boundary`

Flags likely Next.js App Router boundary mistakes: client files importing server-only modules, or server component files using client-only React hooks without a `"use client"` directive.

Why it matters: server/client boundary mistakes often pass code review until runtime or bundling reveals that stateful browser code and server-only APIs were mixed.

Good fixes:

- move server-only imports behind a server component, route handler, or server action
- pass serializable data into focused client components
- add `"use client"` only to the smallest file that owns interactivity

When this is a false positive:

- the file is not part of a Next App Router tree
- a custom build layer deliberately aliases server-only modules

Confidence: **0.86-0.90**. The syntax is direct, but boundary conventions vary by framework setup.

## `route-handler-size`

Flags oversized Next.js `app/**/route.*`, `app/**/page.*`, and `pages` route modules that exceed line, branch, or await budgets.

Default thresholds:

- `route-handler-size.maxLines`: 220
- `route-handler-size.maxBranches`: 14
- `route-handler-size.maxAwaits`: 6

Why it matters: large route/page modules tend to mix request parsing, validation, fetching, authorization, and rendering in one review surface.

Good fixes:

- keep route/page files thin
- move validation and orchestration into server helpers
- colocate data loading with the segment or resource that owns it

When this is a false positive:

- the module is generated
- a small page intentionally performs one simple await chain

Confidence: **0.76-0.86** depending on how many budgets are exceeded.

## `data-loader-sprawl`

Flags async server components and loader-like functions with many awaits or fetch calls in one server-side path.

Default thresholds:

- `data-loader-sprawl.maxAwaits`: 6
- `data-loader-sprawl.maxFetches`: 5
- `data-loader-sprawl.maxBranches`: 5
- `data-loader-sprawl.maxLines`: 90

Why it matters: sequential data loading grows into slow, tightly coupled route code. The right fix is often colocation, batching, or a named server helper.

Good fixes:

- split independent data requirements into focused loaders
- batch related requests behind one server helper
- move segment-specific loading closer to the route segment

When this is a false positive:

- the awaits are intentionally sequential due to dependencies
- the loader is already the owned orchestration boundary

Confidence: **0.64-0.92** based on fetch/await and line pressure.

## `handler-depth`

Flags Express/Fastify-style route handlers with excessive nested control flow or callback depth.

Default thresholds:

- `handler-depth.maxDepth`: 4
- `handler-depth.maxMiddleware`: 5

Why it matters: deeply nested handlers are hard to review and hard to test because validation, loading, and response branches are interleaved.

Good fixes:

- move validation into middleware
- extract loading and policy checks into named helpers
- return early instead of nesting branches

When this is a false positive:

- the route is a generated adapter
- the nesting is a short, deliberate parser boundary

Confidence: **0.76**. Nesting is objective, but route style varies.

## `route-sprawl`

Flags Node route modules that register too many Express/Fastify-style endpoints in one file.

Default threshold:

- `route-sprawl.maxRoutes`: 8

Why it matters: route modules with many endpoints usually have unclear ownership and become hotspots for auth, validation, and response-shape drift.

Good fixes:

- split routes by resource or workflow
- move shared middleware to a module-level helper
- keep one route module per stable ownership boundary

When this is a false positive:

- the file is generated from an API spec
- the endpoints are a deliberately tiny compatibility surface

Confidence: **0.80**. Route call counting is direct, but API shape is project-specific.

## `python-route-sprawl`

Flags Python web modules that register too many routes in one file. The first version
counts Flask app and Blueprint decorators such as `@app.get(...)`, `@bp.post(...)`, and
`@app.route(..., methods=[...])`, plus conservative Django URLConf `path(...)` and
`re_path(...)` entries.

Default threshold:

- `python-route-sprawl.maxRoutes`: 8

Why it matters: route-heavy modules become ownership hotspots for authentication,
validation, response shape, and framework wiring. Splitting by resource or workflow makes
future review smaller and safer.

Good fixes:

- split Flask blueprints by resource or workflow
- move Django URL groups into app-local `urls.py` modules
- move shared auth, validation, or serialization into named helpers
- keep generated route maps separate from hand-owned controller code

When this is a false positive:

- the route map is generated from an API spec
- many decorators are a deliberate compatibility shim
- decorator-like APIs such as caches or task queues are not HTTP route registrations

Confidence: **0.78**. Decorator and URLConf counting is direct, but framework ownership
boundaries are project-specific.

## `duplicate-logic`

Finds structurally similar functions/components after comments, identifiers, strings, and numeric literals are normalized.

Default thresholds:

- `duplicate-logic.minSimilarity`: 0.86
- `duplicate-logic.minLines`: 8
- `duplicate-logic.maxSnippets`: 450

When more eligible snippets are found than `duplicate-logic.maxSnippets`, DebtLens caps pairwise comparisons and emits an advisory warning instead of silently truncating the search space.

Why it matters: AI assistants can produce plausible variants of the same logic in multiple files. Duplicate implementations make bug fixes and behavior changes harder.

Good fixes:

- compare the two implementations manually
- extract shared behavior if the variation is stable
- delete the weaker duplicate if it was accidental
- keep duplication only when coupling would be worse than repetition

When this is a false positive:

- the compared snippets do materially different work after normalization
- the shared shape is too short to clear the minimum line-count threshold

Confidence: **dynamic** — set to the structural similarity score (typically 0.86–1.0 for reported pairs). Higher similarity means stronger evidence of duplication.

## `duplicated-literal`

Flags repeated string and number literals across multiple files.

Default thresholds:

- `duplicated-literal.minLength`: 6
- `duplicated-literal.minCount`: 3

Config:

- `duplicatedLiteral.ignoreStrings`: exact string literal values to ignore. The `next` pack
  includes `use client` and `use server` so App Router directives do not show up as
  duplicated domain literals.

Why it matters: repeated domain literals drift when one copy changes and the others do not.

Good fixes:

- promote repeated domain values to a named constant or enum
- move shared test values into fixtures
- keep literals inline when they are unrelated despite matching text

When this is a false positive:

- the repeated value is incidental rather than one shared concept
- repetition stays inside one file
- the value is a common framework literal; add it to `duplicatedLiteral.ignoreStrings`
  when it is expected in your project

Confidence: **0.74**. Cross-file repetition is useful evidence, but human review decides whether the concept is actually shared.

## `dead-abstraction`

Flags short wrappers that delegate to one call, return one value, or render one JSX element without meaningful behavior.

Default threshold:

- `dead-abstraction.maxWrapperLines`: 8

Why it matters: unnecessary wrappers create names and files that future maintainers must understand, even when they add no durable boundary.

Good fixes:

- inline the wrapper
- keep it only if it is a stable domain boundary
- add the missing behavior that justifies the abstraction

When this is a false positive:

- the wrapper adds meaningful behavior beyond a single pass-through statement
- the file is a route module or a hook wrapper that is intentionally thin by convention

Confidence: **0.68–0.80** depending on the wrapper pattern — delegation to one call (**0.80**), single return (**0.72–0.76**), or single JSX element (**0.68**). Thinner wrappers score lower because the abstraction may still carry naming value.

## `prop-drilling`

Flags components that forward many props to child components.

Default threshold:

- `prop-drilling.maxForwardedProps`: 4

Why it matters: prop drilling can make components into pass-through plumbing instead of meaningful boundaries.

Good fixes:

- colocate data ownership closer to consumers
- use composition slots
- extract a stable context for cross-cutting values
- reduce prop surface area

When this is a false positive:

- the component forwards only a small number of props
- the props are passed only to host primitives instead of user-defined child components

Confidence: **0.73**. Prop counts are objective, but some drilling is acceptable when boundaries are stable.

## `story-only-component`

Flags exported React components whose known relative-import consumers are only Storybook story files.

Why it matters: story-only exported components can grow public APIs without being exercised by app code.

Good fixes:

- move the component into the story if it is only a documentation fixture
- connect the component to production code before expanding its API
- keep it exported only when the story documents a planned app boundary

When this is a false positive:

- the component is consumed through dynamic imports or package boundaries outside the scan target
- the story is intentionally the only current consumer during a migration

Confidence: **0.70**. The signal depends on the scanned import graph.

## `todo-comment`

Flags debt markers in comments, including TODO, FIXME, HACK, temporary, placeholder, and assistant-generation markers.

Configure custom markers via `todoComment.markers`, disable built-in labels with
`todoComment.disableDefaults` (`todo marker`, `fixme/bug marker`), or set
`todoComment.replaceDefaults: true` to use only custom patterns.

Why it matters: a comment can be a legitimate marker, but untracked markers often become permanent.
Markers with issue keys, ticket numbers, or issue URLs are reported with higher confidence than bare markers.

Good fixes:

- create a tracked issue
- add a removal condition
- fix the debt before more code depends on it
- delete stale comments that no longer describe reality

When this is a false positive:

- the word appears in executable code or identifiers instead of a comment
- the comment is already paired with explicit tracking and removal criteria

Confidence: **0.90** for bare markers; higher for tracker-linked markers.

## Vue and Svelte SFC script rules

The `vue` and `svelte` packs scan inline single-file component script blocks while
preserving findings on the original `.vue` or `.svelte` file. They do not analyze
templates, markup, styles, or external `<script src="...">` content.

### `vue-todo-comment`

Flags TODO/FIXME/HACK-style markers inside Vue `<script>` and `<script setup>` blocks.
It uses the same `todoComment` marker configuration as the TS/JS, Python, Kotlin, and
Svelte TODO rules.

Good fixes: track the work, add a removal condition, resolve the debt, or move the note
to an issue if it does not need to live in the component script.

When this is a false positive: the marker is an intentional tracked follow-up with a
clear removal condition, or the project has custom markers that should be configured.

### `vue-large-script`

Flags Vue SFC script blocks or script functions that exceed script-specific size or
branch budgets.

Default thresholds:

- `vue-large-script.maxLines`: 120
- `vue-large-script.maxFunctionLines`: 80
- `vue-large-script.maxBranches`: 12

Good fixes: move unrelated data loading, state orchestration, or pure helpers into
composables, stores, or plain modules; keep the component script focused on the component
boundary.

When this is a false positive: the component is generated, the script is a stable
top-level orchestration shell, or project-specific thresholds need to be raised.

### `vue-duplicate-logic`

Finds near-duplicate functions inside Vue SFC script blocks after comments,
identifiers, strings, and numeric literals are normalized. It reuses
`duplicate-logic.minSimilarity`, `duplicate-logic.minStructuralSimilarity`,
`duplicate-logic.minLines`, and `duplicate-logic.maxSnippets`.

Good fixes: compare the paired scripts manually, extract a composable or helper only when
the variation is stable, or delete the accidental duplicate.

When this is a false positive: the functions share shape but intentionally differ in
domain behavior, or a small amount of repetition is clearer than coupling components.

### `svelte-todo-comment`

Flags TODO/FIXME/HACK-style markers inside Svelte module and instance `<script>` blocks.
It uses the same `todoComment` marker configuration as the other TODO rules and ignores
markup comments.

Good fixes: track the work, add a removal condition, resolve the debt, or move the note
to an issue if it does not need to live in the component script.

When this is a false positive: the marker is already tracked with an explicit removal
condition, or custom marker configuration would better match the project.

### `svelte-large-script`

Flags Svelte component script blocks or script functions that exceed script-specific size
or branch budgets.

Default thresholds:

- `svelte-large-script.maxLines`: 120
- `svelte-large-script.maxFunctionLines`: 80
- `svelte-large-script.maxBranches`: 12

Good fixes: move durable workflow state and data shaping into stores, load helpers, or
plain modules; keep the `.svelte` component script focused on component-owned behavior.

For SvelteKit, this rule scans `.svelte` scripts only. Combine `--pack core,svelte` when
you also want `+page.ts`, `+layout.ts`, `+server.ts`, and shared TypeScript helpers in
the same run.

When this is a false positive: the script is generated, intentionally acts as a stable
component shell, or the default budgets are too strict for the project.

### `svelte-duplicate-logic`

Finds near-duplicate functions inside Svelte module or instance scripts after comments,
identifiers, strings, and numeric literals are normalized. It reuses the same
duplicate-logic thresholds as core and Vue duplication checks.

Good fixes: compare the paired scripts manually, extract a store or helper only when the
shared behavior is stable, or leave the duplication when coupling would make the
components harder to review.

When this is a false positive: the functions are intentionally parallel but domain
specific, or a shared helper would obscure the component ownership boundary.

## Kotlin core rules

The `kotlin` pack ports the core maintainability signals to `.kt` and `.kts` files while
reusing the same `ScanResult`, SARIF, baseline, and reporter contracts.

### `kotlin-duplicate-logic`

Finds structurally similar Kotlin functions after comments, identifiers, strings, and
numeric literals are normalized. It reuses `duplicate-logic.minSimilarity`,
`duplicate-logic.minLines`, and `duplicate-logic.maxSnippets`.

Good fixes: compare the paired functions, extract stable shared behavior only when the
variation is intentional, or delete the weaker duplicate.

### `kotlin-large-function`

Flags Kotlin functions that exceed line or branch-count budgets. It reuses
`large-function.maxLines` and `large-function.maxBranches`.

Good fixes: split branching policy, data normalization, and side effects into named
helpers. Compose-specific view sizing is intentionally left to a separate Compose pack.

### `kotlin-dead-abstraction`

Flags simple Kotlin wrappers such as expression-body pass-through functions and one-line
`return callee(args)` wrappers. It reuses `dead-abstraction.maxWrapperLines` and skips
`override` and `@Composable` wrappers.

Good fixes: inline wrappers that add no durable boundary, or add the missing behavior that
justifies the abstraction.

### `kotlin-todo-comment`

Flags TODO/FIXME/HACK-style markers in Kotlin line comments, block comments, and KDoc. It
uses the same `todoComment` configuration as the TS/JS and Python TODO rules.

Good fixes: track the work, add a removal condition, or resolve the marker before more
code depends on it.

## Swift rules

The `swift` pack ports the core maintainability signals to `.swift` files while
reusing the same `ScanResult`, SARIF, baseline, and reporter contracts.

### `swift-duplicate-logic`

Finds structurally similar Swift functions after comments, identifiers, strings, and
numeric literals are normalized. It reuses `duplicate-logic.minSimilarity`,
`duplicate-logic.minLines`, and `duplicate-logic.maxSnippets`.

Good fixes: compare the paired functions, extract stable shared behavior only when the
variation is intentional, or delete the weaker duplicate.

### `swift-large-function`

Flags Swift functions that exceed line or branch-count budgets. It reuses
`large-function.maxLines` and `large-function.maxBranches`, and skips SwiftUI `body`
properties and `@ViewBuilder` functions.

Good fixes: split branching policy, data normalization, and side effects into named
helpers. SwiftUI view sizing is intentionally left to a separate SwiftUI pack.

### `swift-dead-abstraction`

Flags simple Swift wrappers such as implicit-return pass-through functions and one-line
`return callee(args)` wrappers. It reuses `dead-abstraction.maxWrapperLines` and skips
`override` and `@ViewBuilder` wrappers.

Good fixes: inline wrappers that add no durable boundary, or add the missing behavior that
justifies the abstraction.

### `swift-todo-comment`

Flags TODO/FIXME/HACK-style markers in Swift line comments and block comments. It uses the
same `todoComment` configuration as the TS/JS, Python, and Kotlin TODO rules.

Good fixes: track the work, add a removal condition, or resolve the marker before more
code depends on it.

## SwiftUI rules

The `swiftui` pack scans `.swift` files for SwiftUI view debt. It is separate from
the `swift` core pack: use `--pack swiftui` for SwiftUI-only UI checks, or
`--pack swift,swiftui` when one scan should include both core Swift and SwiftUI signals.

### `swiftui-large-view`

Flags SwiftUI `View` structs whose `body` exceeds SwiftUI-specific line, branch, or local
state budgets.

Default thresholds:

- `swiftui-large-view.maxLines`: 90
- `swiftui-large-view.maxBranches`: 12
- `swiftui-large-view.maxLocalState`: 6

Good fixes:

- split repeated UI regions into smaller views
- move durable screen state into a parent view, observable model, or coordinator
- extract branching policy from rendering code

When this is a false positive:

- the view is a deliberate top-level screen shell with stable slots
- the threshold is too low for generated or migration-era UI code
- the view is a preview; `#Preview` blocks and `PreviewProvider` types are skipped

Confidence: **0.76-0.84** depending on whether size or complexity drove the finding.

### `swiftui-state-sprawl`

Flags SwiftUI views that own many local property-wrapper state holders such as
`@State`, `@StateObject`, `@ObservedObject`, `@FocusState`, `@SceneStorage`, or
`@AppStorage`.

Default threshold:

- `swiftui-state-sprawl.maxStateHolders`: 4

Good fixes:

- pass state and event callbacks into the view
- group related screen state in an `ObservableObject` or dedicated model
- keep ephemeral UI-only state local, but hoist durable workflow state

When this is a false positive:

- the view owns only a small amount of ephemeral UI state
- a single `uiState` value plus an event callback already represents hoisted state
- commented or stringified property-wrapper examples in docs or samples should stay quiet

## Ruby core rules

The `ruby` pack ports the core maintainability signals to `.rb` files while reusing the
same `ScanResult`, SARIF, baseline, and reporter contracts.

### `ruby-duplicate-logic`

Finds structurally similar Ruby methods after comments, identifiers, strings, and numeric
literals are normalized. It reuses `duplicate-logic.minSimilarity`, `duplicate-logic.minLines`,
and `duplicate-logic.maxSnippets`.

### `ruby-large-function`

Flags Ruby methods that exceed line or branch-count budgets. It reuses
`large-function.maxLines` and `large-function.maxBranches`.

### `ruby-dead-abstraction`

Flags simple Ruby wrappers such as one-line pass-through methods and thin delegation
helpers. It reuses `dead-abstraction.maxWrapperLines` and skips `private` methods.

### `ruby-todo-comment`

Flags TODO/FIXME/HACK-style markers in Ruby `#` comments and `=begin`/`=end` blocks. It uses
the same `todoComment` configuration as the TS/JS, Python, and Kotlin TODO rules.

## Rails framework rules

The `rails` pack scans `.rb` files for Rails route and controller ownership debt. It
includes the Ruby core rules: use `--pack ruby` for plain Ruby without Rails framework
checks, or `--pack rails` for Rails apps.

### `rails-route-sprawl`

Flags `config/routes.rb` modules that register too many routes via `get`/`post`/`resources`/`root`/`match`.

Default threshold:

- `rails-route-sprawl.maxRoutes`: 8

### `rails-controller-sprawl`

Flags Rails controllers with too many public action methods.

Default threshold:

- `rails-controller-sprawl.maxActions`: 8

## Jetpack Compose rules

The `compose` pack scans `.kt` and `.kts` files for Compose UI debt. It is separate from
the `kotlin` core pack: use `--pack compose` for Compose-only UI checks, or
`--pack kotlin,compose` when one scan should include both core Kotlin and Compose signals.

### `compose-large-composable`

Flags `@Composable` functions that exceed Compose-specific line, branch, or local state
budgets.

Default thresholds:

- `compose-large-composable.maxLines`: 90
- `compose-large-composable.maxBranches`: 12
- `compose-large-composable.maxLocalState`: 6

Good fixes:

- split repeated UI regions into smaller composables
- move durable screen state into a caller, ViewModel, or state holder
- extract branching policy from rendering code

When this is a false positive:

- the function is a deliberate top-level screen shell with stable slots
- the threshold is too low for generated or migration-era UI code
- the composable is a preview or local sample; previews are skipped when annotated with `@Preview`

Confidence: **0.76-0.84** depending on whether size or complexity drove the finding.

### `compose-state-hoisting`

Flags `@Composable` functions that own many local Compose state holders such as
`remember { mutableStateOf(...) }`, `rememberSaveable { mutableStateOf(...) }`,
`rememberLazyListState()`, or `derivedStateOf { ... }`.

Default threshold:

- `compose-state-hoisting.maxLocalState`: 4

Good fixes:

- pass state and event callbacks into the composable
- group related screen state in a state holder or ViewModel
- keep ephemeral UI-only state local, but hoist durable workflow state

When this is a false positive:

- the composable owns only a small amount of ephemeral UI state
- a single `uiState` plus an event callback already represents hoisted state
- slot APIs use `content: @Composable () -> Unit`; slot parameters are not treated as production composable debt

Confidence: **0.84** for pure local state concentration, slightly lower when the signature
already includes some hoisted state or event parameters.

## `barrel-file`

Flags large re-export-only `index` or `barrel` files.

Default threshold:

- `barrel-file.maxReExports`: 6

Why it matters: broad barrels can hide dependency graph shape and make imports look stable when they are really local plumbing.

Good fixes:

- keep only stable public entrypoints in barrels
- import implementation modules directly inside a feature
- split barrels by ownership or domain

When this is a false positive:

- the barrel is a deliberate public package entrypoint
- the re-export count stays below the configured threshold

Confidence: **0.80**. Re-export-only files are easy to identify, but package API policy is contextual.

## `weak-test-boundary`

Flags production files importing from test-only paths such as `__tests__`, `__mocks__`, `*.test.*`, or `*.spec.*`.

Configuration:

- `weak-test-boundary.allowTypeOnly`: set to `1` to allow type-only imports from test-only modules.

Why it matters: production code depending on test helpers can accidentally pull fixtures, mocks, or unstable test contracts into runtime code.

Good fixes:

- move reusable helpers into production-safe support modules
- keep fixtures and mocks behind test-only callers
- use type-only imports only when the boundary is intentional

When this is a false positive:

- the importer is itself a test file
- type-only imports are intentionally allowed by config

Confidence: **0.86**. Test-only path conventions are strong signals.

## `empty-catch`

Flags `try/catch` blocks whose handler body is empty or contains only comments, silently ignoring errors.

Default thresholds:

- `empty-catch.allowCommentOnly`: `0` (set to `1` to allow comment-only catch bodies)

Why it matters: empty catch blocks hide failures, make debugging harder, and are a common artifact of quick fixes or assistant-generated code.

Good fixes:

- handle the error explicitly and return a typed result
- rethrow or wrap the error with context
- document why ignoring the error is safe, or use an inline suppression with a reason

When this is a false positive:

- best-effort cleanup where failure is intentionally ignored and documented
- catch blocks that delegate to a shared error handler in a macro or generated wrapper

Confidence: **0.88** for empty or comment-only bodies.

## `swallowed-error`

Flags catch blocks that only log an error (`console.error`, `logger.*`, etc.) without rethrowing, returning a handled result, or otherwise acting on the failure.

Why it matters: logging alone often looks like handling but still leaves callers unaware that work failed.

Good fixes:

- rethrow or return a typed error result
- escalate to monitoring with structured context
- handle the failure path the caller depends on

When this is a false positive:

- catch blocks that log and then return a fallback value or error object
- catch blocks that reference the error binding for metrics beyond the log call

Confidence: **0.72**. Log-only handlers are advisory because some teams intentionally log-and-continue at boundaries.

## `floating-promise`

Flags promise-returning calls used as standalone expression statements without `await`, `return`, `void`, or `.catch(...)` handling.

Default thresholds:

- `floating-promise.allowVoid`: `1` (treat `void expr` as intentional fire-and-forget)
- `floating-promise.maxPerFile`: `12`

Why it matters: unawaited promises can fail silently, race, or trigger unhandled rejections — especially inside React effects.

Good fixes:

- `await` the call inside an async function
- return the promise to the caller
- use `void fn()` only when fire-and-forget is intentional
- add `.catch(...)` or effect cleanup when starting async work in hooks

When this is a false positive:

- deliberate fire-and-forget marked with `void`
- callbacks passed directly to APIs that manage promise lifecycle

Confidence: **0.65–0.82**. Higher when the callee is clearly async or returns `Promise<...>`.

## `commented-out-code`

Flags contiguous comment lines that look like executable code rather than prose or debt markers.

Default thresholds:

- `commented-out-code.minLines`: `2`
- `commented-out-code.maxPerFile`: `12`

Why it matters: commented-out code rots, confuses readers, and duplicates history that version control already preserves.

Good fixes:

- delete dead code and rely on git history
- restore the code if it is still needed
- replace with a short comment explaining why something was removed, if context matters

When this is a false positive:

- commented examples in documentation blocks
- license or SPDX header comments
- short comment fragments that happen to look code-like

Confidence: **0.60–0.80**, scaling with run length. This rule is intentionally conservative.

## `long-parameter-list`

Flags functions with too many parameters or multiple boolean flag parameters.

Default thresholds:

- `long-parameter-list.maxParams`: `5`
- `long-parameter-list.maxBooleans`: `2`

When this is a false positive:

- framework-conventional signatures such as `(props)` or `(state, action)`
- generated or adapter glue that must mirror an external API

## `god-file`

Flags kitchen-sink modules that exceed multiple independent sprawl thresholds together (size, exports, top-level declarations, mixed concerns).

Default thresholds:

- `god-file.maxLines`: `400`
- `god-file.maxExports`: `10`
- `god-file.maxTopLevelDecls`: `12`
- `god-file.minAxes`: `3`

When this is a false positive:

- large but cohesive single-purpose utility modules
- generated index files (pair with `barrel-file` guidance)

## `cognitive-complexity`

Scores functions with a Sonar-style cognitive complexity model that penalizes nesting more than flat branching.

Default thresholds:

- `cognitive-complexity.max`: `15`

When this is a false positive:

- generated parsers or dispatch tables with intentionally flat `switch` blocks
- compare with `complex-control-flow` when only cyclomatic count is high

## `python-error-handling`

Flags Python `try/except` handlers that are empty (`pass` only), bare `except:`, or broad `except Exception:` blocks that only log without meaningful handling.

Why it matters: silently swallowed Python exceptions are hard to diagnose in production and common in fast edits.

Good fixes:

- catch specific exception types
- rethrow or wrap with context
- return an explicit error result instead of logging alone

When this is a false positive:

- intentional best-effort cleanup with documented rationale
- handlers that log and then return a fallback value

Confidence: **0.82–0.90** for empty/bare handlers; lower for log-only broad handlers.

## `kotlin-empty-catch`

Flags Kotlin `try/catch` blocks whose catch body is empty or contains only comments.

Why it matters: empty catch blocks hide runtime failures and make Android or server Kotlin code harder to debug.

Good fixes:

- handle the exception explicitly
- rethrow or wrap with context
- document intentional suppression

When this is a false positive:

- generated or framework boilerplate with documented suppression
- catch blocks that delegate to shared error handling

Confidence: **0.88** for empty or comment-only catch bodies.

## `api-surface-sprawl`

Flags files exporting too many public symbols.

Default threshold:

- `api-surface-sprawl.maxExports`: 12

Why it matters: large public surfaces are hard to version, document, and review. Library entrypoints should make ownership obvious.

Good fixes:

- split implementation exports from public entrypoints
- group related exports behind focused modules
- move unstable internals behind non-exported helpers

When this is a false positive:

- the file is an intentional package-level public API
- `export *` sources are deliberately unresolved entrypoints

Confidence: **0.78**. Export counts are objective, but public API policy belongs to the package owner.

## `naming-drift`

Flags files where related domain concepts are represented by many competing names.

Default threshold:

- `naming-drift.minVariants`: 5

Configuration:

- `namingDrift.disableBuiltInVocabulary`: when `true`, skip the built-in media/release vocabulary pack and use only your `vocabulary` groups. Useful for domain-heavy apps where built-in terms are legitimate product language, not drift.

Why it matters: inconsistent names create translation work for every maintainer and can hide duplicate domain models.

Good fixes:

- pick one canonical domain term
- rename adapters at system boundaries
- document vocabulary in a module README
- add typed domain models where possible

When this is a false positive:

- the file uses fewer distinct variants than the configured threshold
- the competing names belong to separate concepts rather than one overloaded domain term

Confidence: **0.62**. Co-occurring domain synonyms are often legitimate vocabulary, so this rule stays advisory.

## `ai-instruction-duplication`

Flags the same normalized instruction block repeated across assistant instruction files such as `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, and `.github/copilot-instructions.md`.

Why it matters: duplicated guidance creates maintenance overhead and makes it unclear which file is canonical when assistants load multiple instruction sources.

Good fixes:

- keep one canonical instruction file and link to it from tool-specific files
- tailor each file to tool-specific context instead of copy-pasting shared blocks

When this is a false positive:

- the repeated text is intentionally mirrored while one file is being migrated
- short boilerplate headers are duplicated but substantive guidance differs elsewhere in the file

Confidence: **0.82**. Normalized text equality is direct evidence, but some duplication may be deliberate during transitions.

## `ai-instruction-contradiction`

Flags conservative opposing directives across assistant instruction files, such as "always run tests" versus "skip tests".

Why it matters: contradictory assistant guidance produces inconsistent edits, failed CI expectations, and review churn.

Good fixes:

- reconcile policies into one canonical instruction
- scope exceptions explicitly ("skip tests only for docs-only edits") in the same section as the base rule

When this is a false positive:

- the policies apply to different contexts and are not actually opposing
- one file is deprecated and scheduled for removal

Confidence: **0.80**. Pattern matching is intentionally conservative and may miss nuanced conflicts or over-flag during migrations.

This pack does **not** detect AI-authored code. It inspects instruction markdown only and performs local analysis without external telemetry.
