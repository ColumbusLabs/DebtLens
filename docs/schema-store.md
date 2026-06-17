# SchemaStore Registration

DebtLens publishes its config schema at:

```text
https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json
```

Until SchemaStore includes DebtLens, add `$schema` manually:

```json
{
  "$schema": "https://raw.githubusercontent.com/ColumbusLabs/DebtLens/main/schema/debtlens.config.schema.json",
  "pack": "react"
}
```

To register with SchemaStore, open a PR to `SchemaStore/schemastore` that:

- Adds the schema as `src/schemas/json/debtlens.json` or references the canonical URL.
- Adds a catalog entry for `debtlens.config.json` and `.debtlensrc.json`.
- Mentions that plugin rule ids are allowed as plain strings in `rules`.
- Includes a test fixture for `debtlens.config.json` using `pack`, `thresholds`, and a plugin-style custom rule id.

Editors that consume SchemaStore, including VS Code, may take time to pick up the association after the external PR merges.
