# DebtLens Rules

DebtLens rules are heuristics. They should produce review prompts, not absolute judgments. Every issue includes confidence, evidence, and a suggested maintainer action.

Rules are grouped into **core**, **react**, and framework packs such as **next**, **react-native**, and **node**. See [`rule-packs.md`](./rule-packs.md) for the full taxonomy.

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

Why it matters: repeated domain literals drift when one copy changes and the others do not.

Good fixes:

- promote repeated domain values to a named constant or enum
- move shared test values into fixtures
- keep literals inline when they are unrelated despite matching text

When this is a false positive:

- the repeated value is incidental rather than one shared concept
- repetition stays inside one file
- the value is a common framework literal

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
