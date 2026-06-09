# DebtLens Rules

DebtLens rules are heuristics. They should produce review prompts, not absolute judgments. Every issue includes confidence, evidence, and a suggested maintainer action.

Rules are grouped into **core** and **react** packs. See [`rule-packs.md`](./rule-packs.md) for the full taxonomy and planned framework packs.

## Confidence scoring

Every finding includes a **confidence** score from 0 to 1. Confidence reflects how strongly the evidence supports the finding — it is separate from **severity**, which reflects how costly the debt would be if real.

| Range | Meaning | How to use it |
| --- | --- | --- |
| 0.85–1.0 | Near-certain | Strong signal; prioritize in review or CI gates |
| 0.70–0.84 | Strong | Worth fixing or tracking; usually not a false positive |
| 0.50–0.69 | Advisory | Review context; may be intentional architecture |
| below 0.50 | Weak | Rare in built-in rules; treat as a hint only |

Use confidence for triage and CI policy (for example, `--fail-on high --fail-on-confidence 0.8`) when you want to gate on high-severity findings that are also well-supported.

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

Confidence: **0.86** when the line budget is exceeded; **0.74** when only hook or branch budgets are exceeded. Line count is the strongest structural signal.

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
- the array literal belongs to another API instead of a React effect hook

Confidence: **0.80**. Effect length and dependency count are measurable, but some complex effects are intentional.

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

Confidence: **0.90**. Comment markers are literal text matches with little interpretation.

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
