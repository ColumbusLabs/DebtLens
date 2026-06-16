# DebtLens Architecture

DebtLens has four layers:

1. CLI input parsing
2. scan orchestration
3. detectors
4. reporters

## CLI

`src/cli/index.ts` uses Commander to parse command-line options. It loads JSON config, merges CLI overrides, runs the scanner, renders the selected report format, and handles `--fail-on` exit behavior.

## Scanner

`src/core/scan.ts` resolves files with `fast-glob`, creates a `ts-morph` project, loads source files, runs selected detectors, filters by minimum severity, and returns a stable `ScanResult` object.

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

In schema v1, issue `id` equals the line-stable `fingerprint` used by baselines. The fingerprint excludes raw line numbers so findings remain stable when code moves. Inline suppressions are preserved in a top-level audit log instead of being represented only as aggregate counts, baseline comparisons populate `summary.deltaFromBaseline`, and multi-rule hotspots are exposed through `summary.correlations`.

Reporter-specific views share aggregate helpers for severity counts, file/rule grouping, correlations, and heatmaps so CLI output, PR comments, Markdown, HTML, and JSON stay aligned.

## Why JSON config only?

DebtLens intentionally starts with JSON config rather than JavaScript config. Static-analysis tools should avoid executing arbitrary project code by default. A plugin API can come later with clear security boundaries.

## Future plugin model

See [`plugin-api-rfc.md`](./plugin-api-rfc.md) for the proposed third-party rule API (RFC — not implemented yet).

Potential design:

```ts
export default defineDebtLensPlugin({
  rules: [myDetector],
  vocabulary: {
    "commerce-entity": ["product", "sku", "item", "listing"]
  }
});
```

Plugin loading should be explicit and disabled in untrusted CI contexts.
