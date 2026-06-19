# Pack Chooser

Choose the smallest pack that matches the repo surface you want to evaluate. Reporting,
baselines, suppressions, SARIF, HTML, JUnit, JSON, Markdown, PR comments, and GitHub
Action behavior are language-neutral; only file discovery and detectors are pack-specific.

| Repo shape | Start with | First command | Recommended first gate |
| --- | --- | --- | --- |
| General TS/JS package | `core` | `debtlens scan . --pack core --min-severity medium` | Advisory or `--fail-on high` after review. |
| React web app | `react` | `debtlens scan . --pack react --min-severity medium` | Baseline legacy debt, then fail on new high findings. |
| Next.js App Router app | `next` | `debtlens scan . --pack next --min-severity medium` | Use `--diff-base` or `--baseline` for PRs. |
| React Native app | `react-native` | `debtlens scan . --pack react-native --min-severity medium` | Start advisory; tune prop and host-forwarding thresholds. |
| Expo Router app | `expo` | `debtlens scan . --pack expo --min-severity medium` | Start advisory with JSON/Markdown artifacts. |
| Node API | `node` | `debtlens scan . --pack node --min-severity medium` | Gate new route/handler sprawl only after baseline. |
| Python service/module | `python` | `debtlens scan . --pack python --min-severity low` | Advisory first; Python TODO debt can be noisy in old repos. |
| Mixed TS/Python monorepo | `core,python` | `debtlens scan . --pack core,python --format json` | Use package or path-scoped baselines. |
| Open-source library | `oss-maintainer` | `debtlens scan . --pack oss-maintainer --min-severity medium` | Prefer reports and issues before hard CI gates. |
| Assistant-heavy repo | `ai-assisted-maintainer` | `debtlens scan . --pack ai-assisted-maintainer --min-severity medium` | Use as review prompts, not authorship detection. |

Future packs such as Vue, Svelte, Swift, Kotlin, Ruby, and AI workflow instruction drift
should reuse this same chooser shape once their MVPs land.
