# Policy Packs As npm Packages

Status: **RFC / adopter pattern**

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

Application repos can either copy the preset into `debtlens.config.json` during rollout or
keep a tiny local file that references the package plugin and repeats only local
overrides.

## Installation

```bash
npm install --save-dev debtlens @org/debtlens-policy
```

Then create:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pluginApiVersion": 1,
  "plugins": ["./node_modules/@org/debtlens-policy/rules/index.mjs"],
  "pack": "oss-maintainer",
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

Security-sensitive pipelines that scan untrusted pull requests can disable org plugins
while still running built-in rules:

```yaml
env:
  DEBTLENS_DISABLE_PLUGINS: "1"
```

## Maintainer requirements

- Version the policy package semantically. Widening rules or lowering confidence floors is
  a minor release; changing plugin rule ids or required config shape is major.
- Keep policy packages small. They should select rules, set thresholds, and add a few
  organization-specific detectors, not replace project ownership.
- Document every custom rule with false-positive examples and a suggested suppression
  policy.
- Run `npm run test:all` in the policy repo and a sample application before publishing.

## Future CLI support

A future `debtlens init --policy @org/debtlens-policy` command could read a package
manifest field and scaffold the local config automatically. Until then, the explicit JSON
pattern above is the supported path because it is auditable and works with the current
plugin loader.
