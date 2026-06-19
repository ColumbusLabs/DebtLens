# Language Pack RFC

Status: **Python and Kotlin core packs shipped**

DebtLens began as a TypeScript/JavaScript scanner. The reporting contract, baselines,
CI workflows, and GitHub Action are language-neutral, and the Python and Kotlin packs now
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

## Multi-language scan model

```bash
debtlens scan . --pack core,python
debtlens scan . --pack core,python,kotlin
```

The scanner should:

1. Resolve files once from include/exclude/git filters.
2. Partition files by language handler (`ts/js`, `python`, `kotlin`, `vue`, etc.).
3. Run each handler's detectors against its own parsed representation.
4. Merge findings, warnings, timing, and summary counts into one `ScanResult`.
5. Preserve deterministic ordering by file path, rule id, and location.

This keeps reporters, baselines, PR comments, SARIF, HTML, and JSON schemas stable.

## Python parser recommendation

Recommendation: use Python's built-in `ast` module plus `tokenize` through a small
sidecar process when Python rules need higher-fidelity syntax.

Why:

- The standard `ast` module is stable, fast enough for static shape rules, and avoids
  vendoring a Python parser into Node.
- A sidecar would let Python-specific rules evolve in Python while the Node CLI remains
  the orchestration layer.
- The first rules map well to syntax trees: TODO comments, duplicate function shape, and
  thin wrappers.

| Option | Strength | Concern |
| --- | --- | --- |
| Python stdlib `ast` + `tokenize` | Stable, no third-party parser dependency, best match for Python syntax versions installed in CI | Requires a Python sidecar and separate source-location mapping |
| `tree-sitter-python` | Embeddable from Node and consistent across machines | Adds native/parser dependency complexity before the language-pack interface is proven |
| Text-only heuristics | Very cheap prototype | Not enough structure for duplicate logic or dead-abstraction confidence |

Current implementation:

- `python-todo-comment` uses conservative in-process comment scanning and shared TODO marker patterns.
- `python-duplicate-logic` extracts function spans, normalizes tokens, and reuses the duplicate-pair pruning shared with TS/JS.
- `python-dead-abstraction` flags single-statement pass-through functions such as `def f(x): return g(x)`.
- `--pack python` widens discovery to `.py` files. Use `--pack core,python` for one merged TS/JS + Python scan.

Possible future sidecar command:

```bash
python -m debtlens_python_adapter --json-lines < file-list.json
```

Initial Python rules:

- `python-todo-comment` mapped from `todo-comment`.
- `python-duplicate-logic` using normalized AST dumps for functions.
- `python-dead-abstraction` for functions that only delegate or wrap a single call.

Known limitations:

- Comments are not preserved in `ast`, so TODO detection needs tokenization.
- Type checkers and import resolution are out of scope for the first pack.
- Framework packs such as Django or Flask should wait until core Python rules are useful.

## Kotlin parser recommendation

Recommendation: keep the first Kotlin pack dependency-free with a conservative lexical
extractor, then revisit `tree-sitter-kotlin` or Kotlin compiler tooling only when deeper
Compose or type-aware rules justify it.

Current implementation:

- `kotlin-todo-comment` scans Kotlin line, block, and KDoc comments with shared TODO marker patterns.
- `kotlin-duplicate-logic` extracts block-bodied functions, normalizes comments, strings, numbers, and identifiers, and reuses duplicate-pair pruning.
- `kotlin-large-function` counts function lines and conservative branch tokens.
- `kotlin-dead-abstraction` flags simple expression-body or single-return pass-through wrappers.
- `--pack kotlin` widens discovery to `.kt` and `.kts` files and keeps Android source trees visible even though they are excluded by TS/JS defaults.

Known limitations:

- The extractor is not a Kotlin compiler. It intentionally avoids type resolution, import graphs, trailing-lambda semantics, and Compose UI-specific debt.
- `@Composable` wrapper and large-function checks are left to a future Compose pack so core Kotlin does not overclaim UI expertise.
- Framework packs such as Jetpack Compose should wait until core Kotlin findings are calibrated.

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

[`examples/python/`](../examples/python/) and [`examples/kotlin/`](../examples/kotlin/)
are calibrated language-pack fixtures. They are intentionally scanned only when their
language packs or explicit language-specific rules are selected, so TS/JS defaults do not
change for existing users.
