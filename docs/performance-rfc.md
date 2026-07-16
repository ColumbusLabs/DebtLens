# Parallel scan and portable cache RFC

Status: implemented in the scanner core.

## Goals and invariants

Large scans may use Node worker threads, but concurrency must never change the
finding contract. For the same files, DebtLens version, selected rules, and rule
configuration, serial and parallel scans emit byte-identical `issues` arrays.
Worker scheduling is not observable in finding or warning order.

`--concurrency 1` is the reference serial implementation. `--parallel` selects a
CPU-based default capped at four workers; `--concurrency <n>` selects an explicit
pool size. Small scans can be slower in parallel because worker startup is real
work, so serial remains the default unless parallelism is requested.

## Sharding and aggregation model

Discovery and the canonical full source model are built by the coordinator.
File-local built-in rules are then given deterministic round-robin file shards.
Each worker parses its shard once and runs all selected file-local rules. The
coordinator concatenates shard findings in shard order and then restores detector
registry order before the existing normalization and stable issue sort.

Cross-file rules are an explicit aggregation phase. Rules whose result depends on
repository-wide duplicates, graphs, imports, or paired instruction files run once
on the coordinator with the complete file set. This includes `duplicate-logic`
(and language variants), `duplicated-literal`, `import-cycle`,
`test-duplication`, `story-only-component`, `config-drift`, and the AI instruction
duplication/contradiction rules. They are never run independently on file shards.

Third-party plugin detectors are JavaScript functions and cannot be safely sent
through the structured-clone boundary. When worker concurrency is enabled,
built-in file-local rules use workers and plugin detectors retain the compatible
in-process path. Plugin findings are still merged in selected-rule order. Scan
caching remains disabled when plugins are loaded because their implementations
cannot be content-hash invalidated.

## Worker protocol and failure behavior

Workers receive source snapshots, clone-safe scan options, and built-in detector
IDs. They import the built-in registry themselves; detector functions are never
serialized. A response contains the detector ID, issues, warnings, and optional
profile timing. A worker error fails the scan instead of silently retrying with a
different correctness model.

The source tree uses the TypeScript worker entry under `tsx`; built packages use
the compiled JavaScript entry. Benchmarks use built JavaScript because loading a
TypeScript runtime in every development worker adds startup cost that consumers of
the published CLI do not pay.

## Portable cache contract

Cache format version 3 is intentionally incompatible with earlier absolute-path
entries. Its scan key is SHA-256 over:

- cache format version and DebtLens package version;
- checkout-root-relative scan target and changed-file identities;
- selected detector IDs and all finding-affecting scan/rule configuration.

The entry also stores a sorted scan manifest as target-relative file identity plus
SHA-256 content hash. Cache hits therefore require the same logical paths and
contents, while the checkout may be restored under a different absolute root.
Absolute target and cache paths are not persisted in the cached result; they are
rehydrated for the current invocation. Writes continue to use a temporary file
followed by an atomic rename.

Changing a file, rule configuration, selected rules, cache format, or DebtLens
version produces a miss. Concurrency is deliberately absent from the key because
it cannot affect findings.

## Verification and performance gate

Core tests compare serialized serial and parallel findings, exercise cross-file
rules, verify `--concurrency 1`, preserve deterministic warnings, and restore one
cache artifact into a different checkout root.

After `npm run build`, this command generates a 240-file CPU-oriented fixture,
warms both modes, alternates execution order, compares median timings, and rejects
any byte-level finding difference:

```sh
node scripts/benchmark.mjs --small-only --compare-parallel
```

The dedicated comparison requires at least a 1.05x median speedup by default.
`--runs` and `--min-speedup` make the sample count and machine-specific gate
explicit. The ordinary one-line benchmark fixtures retain their absolute runtime
budgets; they are intentionally not presented as evidence of parallel speedup.
