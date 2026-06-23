# DebtLens Report

Scanned **3** files with **36** rules in **162ms**.

## Summary

- Total issues: **9**
- High: **2**
- Medium: **3**
- Low: **4**
- Info: **0**

## Fix these first

| File | Why | Top rules |
| --- | --- | --- |
| `src/Dashboard.tsx` | 1 high-severity finding; 3 medium-severity findings; 6 distinct rules | dead-abstraction (3), effect-complexity (1), floating-promise (1) |
| `src/duplicateOne.ts` | 1 high-severity finding; 1 duplicate cluster | duplicate-logic (1) |

## High severity

### Prop drilling — `src/Dashboard.tsx:13`

Dashboard forwards 7 props across 3 child components.

Confidence: **73%**

Evidence:
- ReleaseHero: movie, userId, region, theme, onSelect, onSave
- ReleaseGrid: movie, userId, region, theme, onSelect, onSave, onShare
- ReleaseFooter: movie, userId, region, theme, onShare

Suggestion: Consider colocating the data owner closer to consumers, using a composition slot, or extracting a focused context for stable cross-cutting values.

Review prompt: Can data ownership move closer to consumers via composition, context, or a colocated hook?

### Duplicate logic — `src/duplicateOne.ts:1`

normalizeMovieRelease is 100% structurally similar to normalizeGameRelease.

Confidence: **100%**

Evidence:
- src/duplicateOne.ts:1-18 (18 lines)
- src/duplicateTwo.ts:1-18 (18 lines)

Suggestion: Compare the two implementations. Extract shared behavior only if the variation is intentional and stable; otherwise delete the weaker duplicate.

Review prompt: Are both copies intentional? If not, which copy should become canonical and what breaks if you merge them?


## Medium severity

### State sprawl — `src/Dashboard.tsx:13`

Dashboard manages 7 stateful hook calls. This often means one component is coordinating several unrelated workflows.

Confidence: **82%**

Evidence:
- Stateful hooks: useState, useState, useState, useState, useState, useState, useState

Suggestion: Group related state in a reducer, extract state machines into a hook, or move server/cache state out of component state.

Review prompt: Which state variables change together? Could a reducer or domain hook replace independent useState calls?

### Effect complexity — `src/Dashboard.tsx:23`

This useEffect spans 26 lines, has 9 dependencies, 3 branches, and 14 nested calls.

Confidence: **80%**

Evidence:
- Lines: 26 / 30
- Dependencies: 9 / 8
- Branches: 3
- Contains async work

Suggestion: Split unrelated effects, move imperative workflows into named functions, or replace derived state effects with memoized values.

Review prompt: Does this effect do one job? If not, what is the smallest split that preserves behavior?

### Floating promise — `src/Dashboard.tsx:47`

Promise work inside useEffect is not awaited or error-handled.

Confidence: **88%**

Evidence:
- Expression: load()
- Not awaited, returned, assigned, void-marked, or passed as an argument
- Inside React effect without cleanup or error handling
- Calls async function
- Type checker reports Promise<void>

Suggestion: Await the promise inside the effect, chain .catch(), or move async work into a named helper with explicit error handling.


## Low severity

### Debt marker comment — `src/Dashboard.tsx:22`

Comment contains a todo marker.

Confidence: **90%**

Evidence:
- // TODO: split this when the launch rush is over.

Suggestion: Convert the marker into a tracked issue, add a removal condition, or fix it before more code depends on it.

Review prompt: Is there a tracked issue and removal condition? If not, create one or fix the debt now.

### Dead abstraction — `src/Dashboard.tsx:67`

ReleaseHero looks like a thin wrapper: it only forwards to a single JSX element.

Confidence: **68%**

Evidence:
- { return <section>{props.movie.title}</section>; }

Suggestion: Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.

Review prompt: Does this wrapper enforce a boundary today? If not, inline it or add the missing behavior.

### Dead abstraction — `src/Dashboard.tsx:71`

ReleaseGrid looks like a thin wrapper: it only forwards to a single JSX element.

Confidence: **68%**

Evidence:
- { return <section>{props.movie.releaseDate}</section>; }

Suggestion: Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.

Review prompt: Does this wrapper enforce a boundary today? If not, inline it or add the missing behavior.

### Dead abstraction — `src/Dashboard.tsx:75`

ReleaseFooter looks like a thin wrapper: it only forwards to a single JSX element.

Confidence: **68%**

Evidence:
- { return <footer>{props.region}</footer>; }

Suggestion: Keep the wrapper only if it creates a stable domain boundary. Otherwise inline it or add the missing behavior where this abstraction belongs.

Review prompt: Does this wrapper enforce a boundary today? If not, inline it or add the missing behavior.


## Rule correlations

| File | Rules | Issues |
| --- | --- | ---: |
| `src/Dashboard.tsx` | dead-abstraction (3), effect-complexity (1), floating-promise (1), prop-drilling (1), state-sprawl (1), todo-comment (1) | 8 |

## Duplicate logic clusters

| Cluster | Findings | Locations |
| --- | ---: | --- |
| `dup_s74cdt` | 1 | src/duplicateOne.ts:1-18, src/duplicateTwo.ts:1-18 |
