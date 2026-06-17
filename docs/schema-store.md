# SchemaStore Registration

DebtLens publishes its config schema at:

```text
https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json
```

Until SchemaStore includes DebtLens, add `$schema` manually. `debtlens init` writes this
URL into new configs, so VS Code and other JSON-schema-aware editors get autocomplete:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pack": "react"
}
```

The ready-to-submit catalog entry lives at
[`schema/schemastore-catalog-entry.json`](../schema/schemastore-catalog-entry.json):

```json
{
  "name": "DebtLens",
  "description": "Configuration file for the DebtLens maintainability scanner",
  "fileMatch": ["debtlens.config.json", ".debtlensrc.json"],
  "url": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json"
}
```

Registration checklist:

- Open a PR to `SchemaStore/schemastore`.
- Add the catalog entry above to `src/api/json/catalog.json`.
- Use the canonical raw GitHub schema URL so the published schema stays tied to `main`.
- Mention that plugin rule ids are allowed as plain strings in `rules`.
- Include a valid fixture using `pack`, `thresholds`, and a plugin-style custom rule id if the SchemaStore maintainers request one.

The upstream registration PR is
[`SchemaStore/schemastore#5821`](https://github.com/SchemaStore/schemastore/pull/5821).

Editors that consume SchemaStore, including VS Code, may take time to pick up the association after the external PR merges.
