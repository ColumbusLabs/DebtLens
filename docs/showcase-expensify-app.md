# Showcase: Maintainability signals in a large production React Native codebase (Expensify/App)

This report shows DebtLens running against [Expensify/App](https://github.com/Expensify/App), a large, real-world React Native application. It is a curated sample of the most useful findings, intended to demonstrate the kinds of maintainability signals DebtLens surfaces in a mature production codebase.

## Why this repo?

- **MIT-licensed and public** — freely available to scan and quote.
- **Production-scale** — ~6,200 TypeScript/TSX files under `src/` alone.
- **Actively maintained** — a high-traffic repo with continuous contributions.
- **Real-world React Native** — exactly the kind of app DebtLens is built for (React Native, TypeScript, hooks-heavy UI).

It is a great showcase precisely *because* it is large, active, and well-engineered: maintainability signals in a codebase this size are about managing scale and review burden, not about code quality in any pejorative sense.

## Important disclaimer

**DebtLens findings are heuristic signals, not proof of defects.** Every item below is a prompt for human review — "this might be worth a look" — not a verdict. Large components, forwarded props, and duplicated structure are often deliberate, justified, and perfectly correct in context. DebtLens does not execute code, does not understand intent, and makes **no claim about how any code was written or generated**. Treat these as conversation starters for maintainers, weighted by the confidence score shown.

## How this report was generated

```bash
# Cloned Expensify/App and scanned a scoped subset (the component library),
# not the whole repository.
debtlens scan src/components --min-severity info --format markdown
```

- **Scope:** `src/components/` only (1,681 files scanned) — a representative slice, not the full repo.
- **Repo revision:** `c59a4ce` (2026-06-01).
- **DebtLens:** v0.1, 8 rules, ~3.8s to scan the subset.

### Signal volume in the scanned subset

| Rule | Count |
| --- | --- |
| prop-drilling | 361 |
| large-component | 184 |
| todo-comment | 144 |
| effect-complexity | 60 |
| dead-abstraction | 58 |
| state-sprawl | 38 |
| duplicate-logic | 5 |
| naming-drift | 1 |

In a codebase this size, the raw counts matter less than the *shape* of the signal. The curated findings below are the ones a maintainer is most likely to find worth a look. (For real adoption, DebtLens's `--write-baseline` mode records existing signals so a team only sees newly introduced ones on each PR.)

---

## Curated findings

### Near-duplicate structure (consider sharing)

These are high-confidence structural matches — pairs of functions/components with the same shape. Sometimes that is intentional parallelism; sometimes it is an opportunity to share one implementation.

**`Checkbox.tsx` ≈ `RadioButton.tsx`** — confidence **100%**
> `Checkbox` is structurally near-identical to `RadioButton` (29 vs 28 lines). Two selection controls that may share more than they currently do.

**`AnchorForAttachmentsOnly/index.tsx` ≈ `AnchorForCommentsOnly/index.tsx`** — confidence **100%**
> Two anchor variants with the same 9-line shape. A candidate for a single parameterized component.

**`Icon/ExpensifyIconLoader.ts` ≈ `Icon/IllustrationLoader.ts`** — confidence **100%** (two matched pairs)
> `loadExpensifyIconsChunk` ≈ `loadIllustrationsChunk` and `loadExpensifyIcon` ≈ `loadIllustration` — parallel lazy-loaders that could potentially share a generic loader.

**`SentrySendToggle` ≈ `SentryDebugToggle`** (`SentryDebugToolMenu.tsx`) — confidence **100%**
> Two 13-line toggles in the same file with identical structure.

### Components carrying many responsibilities

These are the largest component bodies in the subset by line count, hook usage, and branch points. Large components are common and often justified in feature-rich screens; DebtLens simply flags the extremes as candidates for extraction.

| Component | File | Signal |
| --- | --- | --- |
| `Search` | `Search/index.tsx:274` | ~1,611-line body, 121 hooks, 135 branch points |
| `MoneyRequestView` | `ReportActionItem/MoneyRequestView.tsx:180` | ~1,191-line body, 46 hooks, 102 branches |
| `MoneyRequestReportTransactionList` | `MoneyRequestReportView/MoneyRequestReportTransactionList.tsx:170` | ~791-line body, 75 hooks |
| `TimePicker` | `TimePicker/TimePicker.tsx:118` | ~778-line body, 101 branches |

*(Line counts are DebtLens-measured component-body spans; `--threshold large-component.maxLines` is tunable per project.)*

### Local state concentrated in one component

High counts of stateful hooks can indicate a component coordinating several workflows — sometimes a good candidate for a reducer or an extracted hook.

- **`BaseVideoPlayer`** (`VideoPlayer/BaseVideoPlayer.tsx:35`) — 19 stateful hook calls (confidence 82%).
- **`MoneyRequestReportActionsList`** (`MoneyRequestReportView/MoneyRequestReportActionsList.tsx:87`) — 16 stateful hook calls.

### Overloaded effects

`useEffect` blocks that are long or carry many dependencies can be harder to reason about and re-run more often than intended.

- **`useSearchFocusSync.ts:64`** — a 46-line effect with 14 dependencies and 6 branches (confidence 80%).
- **`DistanceRequestController.tsx:183`** — a 25-line effect with 14 dependencies.

### Wide prop surfaces

These components forward many props onward. A wide forwarding surface can be a deliberate, well-typed API for a flexible primitive — or, at the extreme, a sign that data is threading through several layers. Worth a glance either way.

- **`MenuItem.tsx:609`** — forwards 63 props across 13 child components (confidence 73%).
- **`Button/index.tsx:302`** — forwards 43 props across 3 children.

> Note: for highly configurable primitives like `MenuItem` and `Button`, a broad prop surface is frequently intentional. This is exactly the kind of signal that benefits from human judgment rather than an automated verdict.

### Debt-marker comments

DebtLens surfaces `TODO`/`FIXME`/`HACK`/workaround markers that the authors themselves left in the code — useful for tracking and triage. A few honest examples (quoted verbatim):

- `ChronosTimerHeaderButton.tsx:61` — *"There is still a possible bug where if you are offline, the button could reflect the wrong state. However, there is really no way to fix this without breaking the offline experience."*
- `Attachments/AttachmentCarousel/extractAttachments.ts:76` — *"We apply this small hack to add an image extension and ensure AttachmentView renders the image."*
- `AvatarCropModal/Slider.tsx:70` — *"pointerEventsNone is a workaround to make sure the pan gesture works correctly on mobile safari."*

These are normal, responsible engineering breadcrumbs — DebtLens just makes them easy to find and convert into tracked issues.

---

## Takeaways

- In a production React Native codebase of this scale, the highest-value signals were **near-duplicate components** (clear, actionable) and a small number of **very large components** concentrating responsibilities.
- The breadth of `prop-drilling` and `todo-comment` counts reflects the size of the codebase; in practice a team would adopt with `--write-baseline` and review only newly introduced signals on each PR.
- Every finding here is a **heuristic prompt for review**, not a defect report, and says nothing about how the code was authored.

*Generated with [DebtLens](https://github.com/ColumbusLabs/debtlens). Thresholds and rules are configurable; see the README.*
