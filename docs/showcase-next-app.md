# Showcase: App Router maintainability signals in Next.js Commerce

This showcase is a repeatable workflow for scanning [vercel/commerce](https://github.com/vercel/commerce), a public MIT-licensed Next.js App Router commerce application. The repository describes itself as a server-rendered App Router commerce app using React Server Components, Server Actions, `Suspense`, and optimistic UI patterns.

## Important disclaimer

DebtLens findings are heuristic signals, not proof of defects. A mature template can deliberately use wide component APIs, repeated route shapes, and provider adapters. Treat every finding as a review prompt, not as a verdict on the project or its maintainers.

## Reproduce

```bash
git clone https://github.com/vercel/commerce.git /tmp/commerce
cd /tmp/commerce
git rev-parse --short HEAD
# For a published report, pin this with: git checkout <recorded-sha>
npx debtlens scan app components lib \
  --pack next \
  --min-severity info \
  --format markdown \
  --markdown-heatmap 10 \
  --output debtlens-commerce-report.md
```

Record the commit SHA and scan date in any published report. If the repository structure changes, keep the scope to first-party application directories and avoid generated output.

## What to look for

| Signal | Why it can matter in App Router apps |
| --- | --- |
| Route or loader sprawl | Server Components and route handlers can accumulate product, cart, and SEO concerns in one file. |
| Effect complexity | Client islands should stay small and focused around interaction state. |
| Prop drilling | Product cards, carts, and layout primitives can develop wide forwarding surfaces. |
| Duplicate logic | Provider adapters and route variants may intentionally mirror each other, but high-similarity pairs are worth a maintainer glance. |
| TODO markers | Commerce templates often include integration notes that should become tracked setup work. |

## Suggested report shape

Use the same tone as the Expensify showcase:

- Exact scope and commit SHA.
- Count table by rule.
- A small curated set of findings.
- A visible disclaimer that signals are prompts, not defects.
- A note that first adoption should use baselines and review only new findings.

Generated reports should quote only short snippets and avoid accusatory language.
