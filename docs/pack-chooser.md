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
| Python web app | `python-web` | `debtlens scan . --pack python-web --min-severity low` | Review route ownership before gating; generated URL maps may need exclusions. |
| Vue app | `vue` | `debtlens scan . --pack vue --min-severity low` | Script-block MVP only; template debt needs separate review. |
| Svelte/SvelteKit app | `svelte` | `debtlens scan . --pack svelte --min-severity low` | Script-block MVP only; markup and load routing rules are out of scope. |
| Kotlin service or Android module | `kotlin` | `debtlens scan . --pack kotlin --min-severity low` | Advisory first; add `compose` only for Compose UI debt. |
| Swift service or iOS module | `swift` | `debtlens scan . --pack swift --min-severity low` | Advisory first; add `swiftui` when SwiftUI view debt matters. |
| SwiftUI app or feature module | `swiftui` | `debtlens scan . --pack swiftui --min-severity low` | Start advisory; tune view size and state-holder thresholds after reviewing screens. |
| Jetpack Compose app/module | `compose` | `debtlens scan . --pack compose --min-severity low` | Start advisory; tune size and state-hoisting thresholds after reviewing screens. |
| Mixed TS/Python/SFC/Kotlin/Swift monorepo | `core,python,vue,svelte,kotlin,swift` | `debtlens scan . --pack core,python,vue,svelte,kotlin,swift --format json` | Use package or path-scoped baselines; add `compose` or `swiftui` for UI modules. |
| Open-source library | `oss-maintainer` | `debtlens scan . --pack oss-maintainer --min-severity medium` | Prefer reports and issues before hard CI gates. |
| Ruby service or Rails app | `ruby` / `rails` | `debtlens scan . --pack rails --min-severity low` | Advisory first; review route and controller ownership before gating. |

Future packs such as AI workflow instruction drift should reuse this same chooser shape
once their MVPs land.
