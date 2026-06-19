# Language Pack RFC

Status: **Python, Kotlin core, and Jetpack Compose packs shipped**

DebtLens began as a TypeScript/JavaScript scanner. The reporting contract, baselines,
CI workflows, and GitHub Action are language-neutral, and the Python, Kotlin, and Compose packs now
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
- Framework packs such as Django or Flask can build on decorator/function metadata, but
  URLConf resolution and class-based view inference remain separate framework work.

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

## Vue parser recommendation

Recommended path: use `vue-eslint-parser` for single-file component parsing, extracting
`<script>` and `<script setup>` ASTs while leaving template-specific rules for a later
pack.

Why:

- It is the established parser path used by Vue ESLint tooling.
- It supports both classic script and script setup, which is the critical compatibility
  requirement for maintainability rules.
- The first proof should port a narrow component-size or TODO rule rather than attempt a
  full template analysis.

Initial Vue spike:

1. Add `.vue` file discovery behind an explicit `vue` pack.
2. Parse script blocks only.
3. Run one near-equivalent rule, such as large component/script block size.
4. Document false-positive cases around generated components and heavy template files.

Known limitations:

- Template AST debt signals need Vue-specific guidance and should not reuse React
  component heuristics blindly.
- Source locations must map back to the `.vue` file rather than extracted virtual files.
- Parser dependency should remain optional until the pack is selected.

## Example fixture

[`examples/python/`](../examples/python/), [`examples/kotlin/`](../examples/kotlin/),
and [`examples/compose/`](../examples/compose/) are calibrated language-pack fixtures.
They are intentionally scanned only when their language or framework packs or explicit
language-specific rules are selected, so TS/JS defaults do not change for existing users.
