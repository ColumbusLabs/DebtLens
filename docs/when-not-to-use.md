# When Not To Use DebtLens

DebtLens is a maintainability signal scanner for TypeScript and JavaScript. It is useful when a team wants review prompts for code shape, baseline drift, and CI rollout discipline. It is not the right tool for every repository.

Avoid using DebtLens as the primary gate when:

- The repo is mostly non-TS/JS code. DebtLens can scan JavaScript and TypeScript files in a polyglot monorepo, but it will not understand Python, Ruby, Go, Swift, Rust, or generated platform code.
- The target is generated, vendored, compiled, or checked-in build output. Exclude `dist`, `.next`, generated clients, fixture snapshots, and third-party code.
- You need semantic correctness, runtime behavior, or security proof. DebtLens does not execute code, type-check user projects, model data flow, or replace security scanners.
- The team is unwilling to baseline known debt. On mature repos, use `--write-baseline` first so PRs focus on newly introduced findings.
- The code style intentionally optimizes for large declarative surfaces. UI primitive libraries, generated route maps, and provider adapters often have broad prop or branch surfaces by design.
- You need author attribution or AI-generated-code detection. DebtLens evaluates maintainability outcomes, not who or what wrote the code.

A good first rollout is narrow: scan changed files, start with `--min-severity medium`, publish JSON artifacts, and only fail on high-confidence high-severity findings.
