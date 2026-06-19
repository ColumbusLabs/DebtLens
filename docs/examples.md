# Runnable Example Scenarios

The `examples/` directory contains small projects that exercise real report surfaces. Use
these commands when evaluating output, writing docs, or checking a reporter change.

| Scenario | Command | What it proves |
| --- | --- | --- |
| React dashboard | `debtlens scan examples/react --pack react --min-severity info` | Component, prop, state, duplicate, and naming signals. |
| Next.js App Router | `debtlens scan examples/next --pack next --min-severity info` | Server/client boundary and route/data-loader rules. |
| React Native screen | `debtlens scan examples/react-native --pack react-native --min-severity info` | RN host-forwarding and React-family rules. |
| Node API | `debtlens scan examples/node-api --pack node --min-severity info` | Route and handler-depth signals for server code. |
| Python service | `debtlens scan examples/python --pack python --min-severity info` | Python duplicate, large-function, control-flow, thin-wrapper, and TODO rules. |
| Python web routes | `debtlens scan examples/python-web --pack python-web --min-severity info` | Flask/Blueprint route-sprawl signals plus core Python rules. |
| Vue SFC scripts | `debtlens scan examples/vue --pack vue --min-severity info` | Vue script TODO and duplicate-logic signals with `.vue` line mapping. |
| Svelte SFC scripts | `debtlens scan examples/svelte --pack svelte --min-severity info` | Svelte script TODO and duplicate-logic signals without React rules. |
| Kotlin service | `debtlens scan examples/kotlin --pack kotlin --min-severity info` | Kotlin duplicate, large-function, thin-wrapper, and TODO rules. |
| Jetpack Compose screen | `debtlens scan examples/compose --pack compose --min-severity info` | Compose large-composable and state-hoisting rules. |
| Local plugin | `debtlens scan examples/plugin --config examples/plugin/debtlens.config.json --min-severity info` | Trusted local plugin loading and plugin rule output. |
| False-positive playground | `debtlens scan examples/false-positives --pack react --min-severity info` | Calibrated near-misses that should stay quiet. |

For Markdown or artifact output, add `--format markdown --output debtlens-report.md` or
`--format json --output debtlens-report.json`. For CI-style checks, add `--baseline` or
`--diff-base` only after the first local scan looks credible.
