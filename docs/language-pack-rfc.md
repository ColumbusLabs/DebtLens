# Language Pack RFC

Status: **Python, Vue/Svelte SFC script, Kotlin core, Swift core, Jetpack Compose, SwiftUI, Ruby core, and Rails framework packs shipped**

DebtLens began as a TypeScript/JavaScript scanner. The reporting contract, baselines,
CI workflows, and GitHub Action are language-neutral, and the Python, Vue/Svelte SFC script, Kotlin, and Compose packs now
prove that language-specific detectors can share the same `ScanResult` shape.

## Shared requirements

- Emit the existing `ScanResult` and `DebtIssue` shape.
- Keep stable fingerprints line-shift tolerant where possible.
- Route files by extension before parser work starts.
- Allow one command to scan multiple language roots and merge results deterministically.
- Keep language-specific dependencies optional until a pack is selected.

Longer-term runtime interface:

```ts
export interface LanguagePack {
  id: string;
  extensions: string[];
  rules: Detector[];
  parse(files: ResolvedFile[]): Promise<LanguageContext>;
}

export interface LanguageContext {
  files: Array<{
    relativePath: string;
    content: string;
    ast: unknown;
  }>;
  warnings: string[];
}
```

Current implementation note: built-in packs now declare language metadata, and the
scanner uses a shared language registry for extension routing, include-glob discovery,
detector routing, and the current TS-morph compatibility adapter. `SourceFileInfo`
still includes a `sourceFile` for existing TS/JS detectors and public plugin consumers;
future sidecar/parser work should add richer language contexts without breaking that
contract.

Current built-in registration shape:

```ts
export interface LanguageDefinition {
  id: SourceLanguage;
  label: string;
  extensions: string[];
  includeGlobs: string[];
  parseSourceFile(input: LanguageParseInput): SourceFileInfo;
  defaultExcludeRewrites?: Record<string, string[]>;
}
```

Adding a shipped language now means registering a `LanguageDefinition` plus pack
`languages` metadata; [`src/core/scan.ts`](../src/core/scan.ts) consumes the registry
instead of adding new extension-specific branches. Third-party language definitions
are still a future API surface, while third-party detectors can target registered
languages through `debtlens/plugin`.

## Multi-language scan model

```bash
debtlens scan . --pack core,python
debtlens scan . --pack core,python,vue,svelte
debtlens scan . --pack core,python,kotlin
debtlens scan . --pack kotlin,compose
```

The scanner should continue to:

1. Resolve files once from include/exclude/git filters.
2. Partition files by language handler (`ts/js`, `python`, `kotlin`, `vue`, etc.).
3. Run each handler's detectors against its own parsed representation.
4. Merge findings, warnings, timing, and summary counts into one `ScanResult`.
5. Preserve deterministic ordering by file path, rule id, and location.

This keeps reporters, baselines, PR comments, SARIF, HTML, and JSON schemas stable.

## Python parser recommendation

Recommendation: use Python's built-in `ast` and `tokenize` modules through a small
sidecar process when Python rules need higher-fidelity syntax.

Why:

- The standard `ast` module is stable, fast enough for static shape rules, and avoids
  vendoring a Python parser into Node.
- A sidecar lets Python-specific rules use Python's own syntax model while the Node CLI
  remains the orchestration layer.
- The first rules map well to syntax trees or conservative function spans: TODO comments,
  duplicate function shape, function size, control-flow shape, and thin wrappers.

| Option | Strength | Concern |
| --- | --- | --- |
| Python stdlib `ast` + `tokenize` | Stable, no third-party parser dependency, best match for Python syntax versions installed in CI | Requires a Python sidecar and separate source-location mapping |
| `tree-sitter-python` | Embeddable from Node and consistent across machines | Adds native/parser dependency complexity before the language-pack interface is proven |
| Text-only heuristics | Very cheap prototype | Not enough structure for duplicate logic or dead-abstraction confidence |

Current implementation:

- `python-todo-comment` uses conservative in-process comment scanning and shared TODO marker patterns.
- Python function extraction first tries an embedded stdlib-`ast`/`tokenize` sidecar
  using `python3`, then `python`, and falls back to the previous text parser with a
  scan warning if no runtime is available or parsing fails.
- The sidecar returns normalized function, class, import, decorator, async, method, and
  nested-function metadata plus tokenized comments without changing `ScanResult` or
  reporter schemas.
- `python-duplicate-logic` uses sidecar-backed function spans when available, normalizes
  tokens, and reuses the duplicate-pair pruning shared with TS/JS.
- `python-large-function` reuses the shared line and branch budgets for oversized or
  branch-heavy Python functions.
- `python-complex-control-flow` counts conservative branch tokens and indentation-based
  nesting depth for review-heavy functions.
- `python-dead-abstraction` flags single-statement pass-through functions such as
  `def f(x): return g(x)`.
- `python-error-handling` flags bare/empty except blocks and broad log-only handlers
  while ignoring examples inside comments and strings.
- `--pack python` widens discovery to `.py` files. Use `--pack core,python` for one merged TS/JS + Python scan.

Possible future sidecar command:

```bash
python -m debtlens_python_adapter --json-lines < file-list.json
```

Initial Python rules:

- `python-todo-comment` mapped from `todo-comment`.
- `python-duplicate-logic` using normalized AST dumps for functions.
- `python-large-function` using function spans, line budgets, and branch counts.
- `python-complex-control-flow` using cyclomatic-like complexity and indentation depth.
- `python-dead-abstraction` for functions that only delegate or wrap a single call.

Known limitations:

- Comments are not preserved in `ast`, so TODO detection remains text-based even though
  the sidecar exposes tokenized comment metadata for future rules.
- Type checkers and import resolution are out of scope for the first pack; imports are
  reported as syntax metadata only.
- The shipped `python-web` pack builds on decorator/function metadata for Flask and
  Blueprint routes, and uses conservative text matching for Django `path()`/`re_path()`
  URLConf entries. Class-based view inference and deep URL resolver analysis remain
  separate framework work.

## Kotlin parser recommendation

Recommendation: keep Kotlin and Compose packs dependency-free with a conservative lexical
extractor, then revisit `tree-sitter-kotlin` or Kotlin compiler tooling only when deeper
type-aware rules justify it.

Current implementation:

- `kotlin-todo-comment` scans Kotlin line, block, and KDoc comments with shared TODO marker patterns.
- `kotlin-duplicate-logic` extracts block-bodied functions, normalizes comments, strings, numbers, and identifiers, and reuses duplicate-pair pruning.
- `kotlin-large-function` counts function lines and conservative branch tokens.
- `kotlin-dead-abstraction` flags simple expression-body or single-return pass-through wrappers.
- `--pack kotlin` widens discovery to `.kt` and `.kts` files and keeps Android source trees visible even though they are excluded by TS/JS defaults.
- `compose-large-composable` flags oversized or branch-heavy `@Composable` functions.
- `compose-state-hoisting` flags composables that own many local Compose state holders.
- `--pack compose` also widens discovery to `.kt` and `.kts`, but selects only Compose UI rules unless combined with `kotlin`.

Known limitations:

- The extractor is not a Kotlin compiler. It intentionally avoids type resolution, import graphs, and trailing-lambda semantics.
- Compose checks are lexical UI-shape signals; they do not claim ViewModel ownership, navigation ownership, or type-aware state-flow analysis.
- Compose remains a separate pack so core Kotlin does not overclaim UI expertise.

## Swift parser recommendation

Recommendation: keep the Swift pack dependency-free with a conservative lexical
extractor, then revisit `tree-sitter-swift` or SourceKit tooling only when deeper
type-aware rules justify it.

Current implementation:

- `swift-todo-comment` scans Swift line and block comments with shared TODO marker patterns.
- `swift-duplicate-logic` extracts block-bodied functions, normalizes comments, strings, numbers, and identifiers, and reuses duplicate-pair pruning.
- `swift-large-function` counts function lines and conservative branch tokens while skipping SwiftUI `body` properties and `@ViewBuilder` functions.
- `swift-dead-abstraction` flags simple single-return or implicit-return pass-through wrappers.
- `--pack swift` widens discovery to `.swift` files and rewrites the default `ios/**` exclude so Swift sources under iOS app trees remain visible.
- `swiftui-large-view` flags oversized or branch-heavy SwiftUI `View` bodies.
- `swiftui-state-sprawl` flags views that own many local property-wrapper state holders.
- `--pack swiftui` also widens discovery to `.swift`, but selects only SwiftUI view rules unless combined with `swift`.

Known limitations:

- The extractor is not a Swift compiler. It intentionally avoids type resolution, import graphs, and trailing-closure semantics.
- UIKit view-controller sizing remains future framework-pack work separate from SwiftUI.

## Ruby parser recommendation

Recommendation: keep Ruby and Rails packs dependency-free with a conservative lexical
extractor, then revisit Ripper or `parser` gem sidecars only when deeper type-aware rules
justify an optional subprocess.

Current implementation:

- `ruby-todo-comment` scans Ruby `#` line comments and `=begin`/`=end` block comments with shared TODO marker patterns.
- `ruby-duplicate-logic` extracts `def` methods, normalizes comments, strings, numbers, and identifiers, and reuses duplicate-pair pruning.
- `ruby-large-function` counts method lines and conservative branch tokens.
- `ruby-dead-abstraction` flags simple single-call pass-through wrappers and skips non-public methods.
- `--pack ruby` widens discovery to `.rb` files without changing TS/JS defaults.
- `rails-route-sprawl` heuristically counts route entries in `routes.rb`.
- `rails-controller-sprawl` counts public actions in `*_controller.rb` files.
- `--pack rails` selects Ruby core rules plus both Rails framework sprawl rules.

Known limitations:

- The extractor is not a Ruby interpreter. It intentionally avoids constant resolution, `eval`, metaprogramming, and Rails engine mount analysis.
- Route counting expands `resources` conservatively; member/collection blocks need richer parsing later.

## Vue and Svelte SFC script packs

Current implementation: Vue and Svelte use a dependency-free single-file component
extractor that scans inline `<script>` blocks, preserves original `.vue` or `.svelte`
line positions in a virtual TS/JS source file, and runs only SFC-specific script rules.
The source file path in every finding remains the original component file.

Shipped rules:

- `vue-todo-comment`, `vue-large-script`, `vue-duplicate-logic`
- `svelte-todo-comment`, `svelte-large-script`, `svelte-duplicate-logic`

The extractor supports classic Vue `<script>`, Vue `<script setup>`, Svelte module
scripts, and Svelte instance scripts. External `<script src="...">` content is not
loaded; scan the referenced TS/JS file through `--pack core` if it needs coverage.

For SvelteKit projects, `--pack svelte` covers `.svelte` component scripts only. Use
`--pack core,svelte` when the same scan should also include `+page.ts`, `+layout.ts`,
`+server.ts`, endpoint helpers, and shared `.ts` modules.

Known limitations:

- Template and markup AST debt signals are out of scope for the shipped MVP.
- Vue directive complexity, slot ownership, scoped-style debt, and Svelte markup/control
  flow need framework-specific rules instead of React heuristic reuse.
- Component compiler semantics, import resolution, and type-aware analysis are not
  attempted.
- Line mapping is intentionally conservative: script blocks keep their original
  component lines, and non-script content is masked out of the virtual source.

Future richer parser path: use `vue-eslint-parser` for Vue single-file component
template/script parsing and a Svelte compiler or language-server-backed parser when
template-aware Svelte rules justify the dependency.

Why:

- It is the established parser path used by Vue ESLint tooling.
- It supports both classic script and script setup, which is the critical compatibility
  requirement for maintainability rules.
- Template-aware work should build on framework parsers once the script-block pack has
  enough real-world calibration data.

## Example fixture

[`examples/python/`](../examples/python/), [`examples/kotlin/`](../examples/kotlin/),
[`examples/vue/`](../examples/vue/), [`examples/svelte/`](../examples/svelte/), and
[`examples/compose/`](../examples/compose/) are calibrated language-pack fixtures.
They are intentionally scanned only when their language or framework packs or explicit
language-specific rules are selected, so TS/JS defaults do not change for existing users.
