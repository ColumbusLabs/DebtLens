# Plugin API RFC

Status: **Shipped (v1)** — the loader, `pluginApiVersion` validation, the `DEBTLENS_DISABLE_PLUGINS` escape hatch, plugin threshold defaults ([#73](https://github.com/ColumbusLabs/DebtLens/issues/73)), and vocabulary merging ([#74](https://github.com/ColumbusLabs/DebtLens/issues/74)) are implemented.

## Problem

Teams want custom DebtLens rules without forking the CLI. Today all detectors are hardcoded in [`src/detectors/index.ts`](../src/detectors/index.ts) and config is JSON-only ([`SECURITY.md`](../SECURITY.md)).

## Goals

- Third-party rules use the **same `Detector` interface** as built-ins.
- Plugin loading is **explicit** in config — no implicit discovery.
- **Versioned** API surface with fail-fast mismatch errors.
- **Local ESM modules only** by default; no remote fetch at load time.

## Non-goals (v1 of plugins)

- npm package auto-discovery
- JavaScript/TypeScript config files that execute on load
- Sandboxed WASM rules

## Detector contract

Plugins export detectors matching the built-in interface ([`src/core/types.ts`](../src/core/types.ts)):

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

`DetectorContext` provides:

- `project` — ts-morph `Project`
- `files` — parsed `SourceFileInfo[]`
- `options` — merged `ScanOptions`
- `getThreshold(key, fallback)` — numeric threshold helper
- `addWarning(message)` — non-fatal scan warnings

Issues must include `message`, `severity`, `confidence`, `file`, `location`, `evidence`, and `suggestion` per [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Config shape (proposed)

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./debtlens-rules/custom-rule.mjs"],
  "rules": ["duplicate-logic", "custom-boundary-rule"]
}
```

| Field | Meaning |
| --- | --- |
| `pluginApiVersion` | Must match the DebtLens runtime plugin API version |
| `plugins` | Array of paths to ESM modules, resolved relative to the config file directory |

Each plugin module default-exports either:

- a single `Detector`, or
- `{ rules: Detector[], thresholds?: Record<string, number>, vocabulary?: Record<string, string[]> }`

`thresholds` supplies defaults for `context.getThreshold` keys; they merge after
built-in defaults, so user config `thresholds` and the `--threshold` flag override
them. `vocabulary` contributes naming-drift concept groups; user config groups with
the same id override plugin groups. When multiple plugins set the same threshold key
or concept id, the later plugin wins and a warning is emitted.

## Loading model

1. Parse JSON config (no `require()` of user JS).
2. If `plugins` present, for each path:
   - Resolve to absolute path under config directory
   - `import()` the module (Node ESM)
   - Validate exported detectors (required fields, unique ids)
3. Merge plugin detectors with built-in registry; explicit `rules` array selects which run.
4. On `pluginApiVersion` mismatch → throw with clear upgrade message.

Built-in detectors always register first; plugin ids must not collide with built-in ids unless intentionally replacing (replacement deferred — collision is an error in v1).

## Versioning

- **`pluginApiVersion`** in config matches **`DEBTLENS_PLUGIN_API_VERSION`** in the CLI (integer, bumped on breaking detector-context changes).
- Patch/minor DebtLens releases keep the same plugin API version when `DetectorContext` is unchanged.
- Changelog documents API version bumps.

## Security

Align with [`SECURITY.md`](../SECURITY.md):

- **No network** during plugin load.
- **No arbitrary code** from config values — only explicit `plugins` paths.
- Paths must stay within the repository (reject `..` traversal outside repo root).
- CI environments may set `DEBTLENS_DISABLE_PLUGINS=1` to skip loading entirely; built-in rules still run and a single stderr note is emitted when configured plugins are skipped.

Untrusted repos: treat plugins like any local code — only enable in trusted pipelines.

## Minimal example plugin

```js
// debtlens-rules/no-console.mjs
/** @type {import("debtlens/plugin").Detector} */
export const noConsoleDetector = {
  id: "no-console",
  name: "No console",
  description: "Flags console.log in production source.",
  defaultSeverity: "low",
  tags: ["hygiene"],
  detect(context) {
    const issues = [];
    for (const file of context.files) {
      if (file.content.includes("console.log")) {
        issues.push({
          id: `dl_nc_${file.relativePath}`,
          ruleId: "no-console",
          ruleName: "No console",
          severity: "low",
          confidence: 0.85,
          message: "console.log found in source.",
          file: file.relativePath,
          location: { startLine: 1 },
          tags: ["hygiene"],
          suggestion: "Remove debug logging or route through a logger.",
        });
      }
    }
    return issues;
  },
};

export default { rules: [noConsoleDetector] };
```

A runnable version of this plugin lives in [`examples/plugin/`](../examples/plugin/), and types ship from the published `debtlens/plugin` entry point (`import type { Detector } from "debtlens/plugin"`).

## Implementation phases

1. **RFC merged** (this document) — no runtime change ✅
2. **Loader prototype** — `import()` + validation ✅ ([#68](https://github.com/ColumbusLabs/DebtLens/issues/68))
3. **Schema + docs** — `plugins` / `pluginApiVersion` in JSON schema ✅ ([#69](https://github.com/ColumbusLabs/DebtLens/issues/69))
4. **Example plugin** — [`examples/plugin/`](../examples/plugin/) + integration test ✅ ([#72](https://github.com/ColumbusLabs/DebtLens/issues/72))
5. **Stable export** — `debtlens/plugin` types entry point ✅ ([#70](https://github.com/ColumbusLabs/DebtLens/issues/70))

## Open questions

- ~~Should plugins export threshold defaults?~~ Shipped ([#73](https://github.com/ColumbusLabs/DebtLens/issues/73)): `thresholds` export merges after built-in defaults, before user config.
- ~~Allow vocabulary packs from plugins?~~ Shipped ([#74](https://github.com/ColumbusLabs/DebtLens/issues/74)): `vocabulary` export merges below user config groups.
- Per-plugin enable flags vs flat `rules` list?

Track decisions in issue [#26](https://github.com/ColumbusLabs/DebtLens/issues/26).
