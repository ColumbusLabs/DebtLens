# DebtLens Rules

DebtLens rules are heuristics. They should produce review prompts, not absolute judgments. Every issue includes confidence, evidence, and a suggested maintainer action.

Rules are grouped into **core** and **react** packs. See [`rule-packs.md`](./rule-packs.md) for the full taxonomy and planned framework packs.

## `large-component`

Flags React-style PascalCase functions, `memo`/`forwardRef` wrappers, and class components
that extend `Component`/`PureComponent` when they exceed line, hook, or branch thresholds.

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
- the component stays within the configured line, hook, and branch budgets

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
- the array literal belongs to another API instead of a React effect hook

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

## `todo-comment`

Flags debt markers in comments, including TODO, FIXME, HACK, temporary, placeholder, and assistant-generation markers.

Configure custom markers via `todoComment.markers`, disable built-in labels with
`todoComment.disableDefaults` (`todo marker`, `fixme/bug marker`), or set
`todoComment.replaceDefaults: true` to use only custom patterns.

Why it matters: a comment can be a legitimate marker, but untracked markers often become permanent.

Good fixes:

- create a tracked issue
- add a removal condition
- fix the debt before more code depends on it
- delete stale comments that no longer describe reality

When this is a false positive:

- the word appears in executable code or identifiers instead of a comment
- the comment is already paired with explicit tracking and removal criteria

## `naming-drift`

Flags files where related domain concepts are represented by many competing names.

Default threshold:

- `naming-drift.minVariants`: 4

Why it matters: inconsistent names create translation work for every maintainer and can hide duplicate domain models.

Good fixes:

- pick one canonical domain term
- rename adapters at system boundaries
- document vocabulary in a module README
- add typed domain models where possible

When this is a false positive:

- the file uses fewer distinct variants than the configured threshold
- the competing names belong to separate concepts rather than one overloaded domain term
