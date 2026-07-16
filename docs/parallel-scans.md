# Parallel scans and shared cache

DebtLens stays serial by default. For a large, CPU-heavy repository scan, enable
the bounded worker pool with either the automatic setting or an explicit size:

```sh
debtlens scan . --parallel
debtlens scan . --concurrency 4
```

Use `--concurrency 1` when comparing behavior, profiling startup, or running in a
single-CPU container. Parallel and serial scans have the same findings and stable
ordering. Cross-file rules still see the whole repository; they are not evaluated
independently on incomplete shards.

Workers help when detector work is large enough to repay startup and source
transfer. Small repositories, narrow `--changed` scans, and source-tree execution
through `tsx` may be faster with `--concurrency 1`. The published built CLI avoids
the per-worker TypeScript runtime startup cost.

## Restore the cache in CI

`--cache-dir` enables the scan cache and writes `cache.json` below the supplied
directory:

```sh
debtlens scan . --parallel --cache-dir .cache/debtlens
```

Save and restore `.cache/debtlens` with the CI provider's normal cache or artifact
mechanism. Cache entries use checkout-relative file identities and content hashes,
so a cache created at one runner's checkout path can hit after restoration at a
different path. The key also includes DebtLens version, selected rules, and all
finding-affecting rule configuration.

Do not share a writable cache directory between simultaneous scans. Each cache
file is atomically replaced, but the store is a last-writer-wins local artifact,
not a network coordination service. Give parallel jobs separate writable paths,
then let the CI cache service publish one completed artifact.

`--cache [path]` remains available for a specific cache file. Plugin-enabled scans
do not cache results because DebtLens cannot hash arbitrary plugin implementation
code. Plugin detectors also run in-process when worker concurrency is selected;
built-in file-local rules still use workers.

For the design contract and comparative benchmark, see
[`performance-rfc.md`](./performance-rfc.md).
