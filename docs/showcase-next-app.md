# Showcase: App Router maintainability signals in Next.js Commerce

This report shows DebtLens running against [vercel/commerce](https://github.com/vercel/commerce),
a public MIT-licensed Next.js App Router commerce application. It is a curated sample of
the most useful findings, intended to demonstrate the kinds of maintainability signals the
`next` pack surfaces in a mature template codebase.

## Why this repo?

- **MIT-licensed and public** — freely available to scan and inspect.
- **App Router focused** — server-rendered commerce flows using React Server Components,
  Server Actions, `Suspense`, and client interaction islands.
- **Template-scale** — small enough for a quick local scan, but realistic enough to show
  route, data adapter, and UI composition patterns.

It is a useful showcase precisely because it is already well-structured: DebtLens signals
in a template like this are review prompts for maintainers adopting or extending the
template, not claims that the upstream project is broken.

## Important disclaimer

**DebtLens findings are heuristic signals, not proof of defects.** Every item below is a
prompt for human review — "this might be worth a look" — not a verdict. App Router
templates often repeat adapter shapes, export broad integration types, and forward props
through intentionally flexible UI primitives. DebtLens does not execute code, does not
understand product intent, and makes **no claim about how any code was written or
generated**.

## How this report was generated

```bash
git clone https://github.com/vercel/commerce.git /tmp/debtlens-commerce
cd /tmp/debtlens-commerce
git rev-parse --short HEAD
# 3761e52

debtlens scan . \
  --include "app/**/*.ts,app/**/*.tsx,components/**/*.ts,components/**/*.tsx,lib/**/*.ts,lib/**/*.tsx" \
  --pack next \
  --min-severity info \
  --format json \
  --output debtlens-commerce-report.json
```

- **Scope:** `app/`, `components/`, and `lib/`.
- **Repo revision:** `3761e52` (recorded 2026-06-17).
- **DebtLens:** local v0.3 development build, `next` pack, 64 files scanned, 23 rules run,
  ~0.5s elapsed.

### Signal volume in the scanned subset

| Rule | Count |
| --- | ---: |
| `duplicated-literal` | 12 |
| `duplicate-logic` | 6 |
| `prop-drilling` | 3 |
| `api-surface-sprawl` | 2 |

The raw count is less important than the signal shape. The highest-value review prompts
are the repeated Shopify adapter helpers and public API surface checks; repeated framework
literals such as `"use client"` are expected in App Router apps and are good candidates for
threshold tuning or confidence floors in a real rollout.

---

## Curated findings

### Repeated Shopify adapter shapes

DebtLens found several high-confidence structural matches in `lib/shopify/index.ts`:

| Pair | Why it may be worth reviewing |
| --- | --- |
| `reshapeCollections` ≈ `reshapeProducts` | Both normalize API data into local shapes; shared helper boundaries may reduce future drift. |
| `addToCart` ≈ `removeFromCart` ≈ `updateCart` | Cart mutation helpers intentionally mirror one another, but the repeated structure is worth keeping synchronized. |
| `getCollectionProducts` ≈ `getProductRecommendations` | Query wrappers can be deliberately parallel; a shared query/reshape path may be useful if behavior changes together. |

The duplicate cluster view grouped the cart mutation helpers together, which is more useful
than treating each pair as an unrelated finding.

### Public Shopify API surface

`api-surface-sprawl` flagged two Shopify integration files:

| File | Signal |
| --- | --- |
| `lib/shopify/types.ts` | 32 exported public symbols, above the default threshold of 14. |
| `lib/shopify/index.ts` | 16 exported public symbols, also above the threshold. |

For a template adapter, a broad export surface may be intentional. The value of this signal
is that downstream maintainers can decide whether the adapter boundary is still coherent
after they customize products, carts, pages, and collection behavior.

### Prop forwarding in reusable UI primitives

DebtLens reported medium-severity prop-forwarding prompts in:

- `components/grid/three-items.tsx` — `ThreeItemGridItem` forwards layout and item props
  through `Link` and `GridTileImage`.
- `components/grid/tile.tsx` — `GridTileImage` forwards label and product-display props
  into the label component.
- `components/product/product-description.tsx` — product data flows into price, variant,
  and description children.

These are normal composition patterns in a commerce UI. In a forked application, the same
signals can help spot when a reusable primitive has become an accidental feature container.

### Repeated literals that should be tuned

The largest low-signal item was repeated `"use client"` directives across client files.
That is expected in App Router code and should usually be handled by threshold tuning,
rule confidence floors, or a future framework-aware literal ignore. This is a useful
example of why first adoption should start with a baseline and human review.

---

## Takeaways

- The `next` pack produced a small, reviewable result set on a public App Router template.
- The most actionable signals were **duplicate adapter logic** and **public API surface
  size** in the Shopify integration layer.
- Some findings, especially repeated framework literals, are adoption-tuning material
  rather than defects.
- A real team should adopt with `--write-baseline`, review only newly introduced findings
  in PRs, and tune per-rule confidence floors before making DebtLens a hard gate.

*Generated with [DebtLens](https://github.com/ColumbusLabs/debtlens). Thresholds and rules are configurable; see the README.*
