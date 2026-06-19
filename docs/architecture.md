# DebtLens Architecture

DebtLens has four layers:

1. CLI input parsing
2. scan orchestration
3. detectors
4. reporters

## CLI

`src/cli/index.ts` uses Commander to parse command-line options. It loads JSON config, merges CLI overrides, runs the scanner, renders the selected report format, and handles `--fail-on` exit behavior.

## Scanner

`src/core/scan.ts` resolves files with `fast-glob`, creates a `ts-morph` project, loads
source files, runs selected detectors, filters by minimum severity, and returns a stable
`ScanResult` object. Language-specific detectors share that result contract; Python rules
already run beside TS/JS rules and future language packs should preserve the same summary,
baseline, SARIF, HTML, JUnit, Markdown, PR comment, and JSON shapes.

The scanner does not execute project code.

## Detectors

A detector implements:

```ts
export interface Detector {
  id: string;
  name: string;
  description: string;
  defaultSeverity: Severity;
  tags: string[];
  detect: (context: DetectorContext) => Promise<DebtIssue[]> | DebtIssue[];
}
```

Each detector receives parsed `ts-morph` source files plus threshold helpers. The rule should return reviewable issues with evidence and a suggestion.

Current detectors live in `src/detectors`.

## Reporters

Reporters convert `ScanResult` to terminal text, JSON, Markdown, PR-comment Markdown, SARIF, HTML, or JUnit XML.

Future reporters should use the same `ScanResult` object so downstream integrations can remain stable. JSON output carries `schemaVersion: 1` and is described by the published schema at:

```text
https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.scan-result.schema.json
```

In schema v1, issue `id` equals the line-stable `fingerprint` used by baselines. The fingerprint excludes raw line numbers so findings remain stable when code moves. Accepted inline suppressions are preserved in a top-level audit log instead of being represented only as aggregate counts. `--audit-suppressions` adds directive-level `suppressionDirectives` entries for used, unused, and not-evaluated inline comments, baseline comparisons populate `summary.deltaFromBaseline`, and multi-rule hotspots are exposed through `summary.correlations`.

Reporter-specific views share aggregate helpers for severity counts, file/rule grouping, correlations, and heatmaps so CLI output, PR comments, Markdown, HTML, and JSON stay aligned.

## Why JSON config by default?

DebtLens keeps `debtlens.config.json` as the default because static-analysis tools should
avoid executing arbitrary project code by default. Local plugins are now supported, but
they must be explicitly configured, versioned with `pluginApiVersion`, and can be disabled
in CI with `DEBTLENS_DISABLE_PLUGINS=1`.

## Plugin model

See [`plugin-api-rfc.md`](./plugin-api-rfc.md) for the shipped plugin API contract and
remaining future extension points.

Potential design:

```ts
export default defineDebtLensPlugin({
  rules: [myDetector],
  vocabulary: {
    "commerce-entity": ["product", "sku", "item", "listing"]
  }
});
```

Plugin loading is explicit and should be disabled in untrusted CI contexts.
