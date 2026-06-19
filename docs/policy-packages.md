# Policy Packs As npm Packages

Status: **policy package scaffold**

Organizations that want a shared DebtLens policy can publish a package such as
`@org/debtlens-policy`. The package owns a plugin, a config preset, and CI guidance so
application repositories do not copy rule choices by hand.

## Package shape

```text
@org/debtlens-policy/
  package.json
  preset.json
  rules/
    index.mjs
  README.md
```

`preset.json` should be plain JSON so adopting repositories keep the same security model
as `debtlens.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./node_modules/@org/debtlens-policy/rules/index.mjs"],
  "pack": "oss-maintainer",
  "minSeverity": "medium",
  "ruleSeverities": {
    "todo-comment": "info"
  },
  "ruleConfidenceFloors": {
    "duplicate-logic": 0.82
  }
}
```

`preset.json` is data, but the referenced `rules/index.mjs` module is trusted code:
DebtLens loads policy modules as ESM plugins in the scan process. Only use package or
local policy modules maintained by your organization, and disable plugins in CI when a
workflow scans untrusted repositories or pull requests.

## Installation

```bash
npm install --save-dev debtlens @org/debtlens-policy
```

Then scaffold a local config from the package:

```bash
debtlens init --policy @org/debtlens-policy
```

The package-name form uses the default package entry point at `rules/index.mjs`. If the
package publishes multiple policies, pass the installed package module path:

```bash
debtlens init --policy ./node_modules/@org/debtlens-policy/rules/index.mjs
debtlens init --policy ./node_modules/@org/debtlens-policy/presets/strict.mjs
```

For a checked-in policy module, pass a local file path instead:

```bash
debtlens init --policy ./debtlens-policy/index.mjs
debtlens init --policy ./tools/debtlens-policies/strict.mjs
```

The generated `debtlens.config.json` pins the plugin API version and references the
policy module. A package-backed config looks like:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./node_modules/@org/debtlens-policy/rules/index.mjs"],
  "pack": "oss-maintainer",
  "include": ["src/**/*.{ts,tsx,js,jsx}"]
}
```

For local files, the same shape uses the local module path:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./debtlens-policy/index.mjs"],
  "include": ["src/**/*.{ts,tsx,js,jsx}"]
}
```

## CI usage

```yaml
- uses: ColumbusLabs/debtlens@v0
  with:
    config: debtlens.config.json
    changed: origin/${{ github.base_ref }}
    upload-json-artifact: true
    fail-on: high
```

Policy modules are trusted code loaded as plugins. Security-sensitive pipelines that scan
untrusted pull requests can disable org plugins while still running built-in rules:

```yaml
env:
  DEBTLENS_DISABLE_PLUGINS: "1"
```

With `DEBTLENS_DISABLE_PLUGINS=1`, DebtLens skips configured policy modules, including
their custom rules, threshold defaults, and vocabulary contributions. Built-in rules and
local non-plugin config still run.

## Maintainer requirements

- Version the policy package semantically. Widening rules or lowering confidence floors is
  a minor release; changing plugin rule ids or required config shape is major.
- Keep policy packages small. They should select rules, set thresholds, and add a few
  organization-specific detectors, not replace project ownership.
- Document every custom rule with false-positive examples and a suggested suppression
  policy.
- Run `npm run test:all` in the policy repo and a sample application before publishing.
