# MCP Server

DebtLens ships a small stdio MCP server for agents and editors that can call Model
Context Protocol tools. It delegates to the same CLI commands maintainers already use, so
the results match local `debtlens scan`, `doctor`, `rules`, and `explain` output.

## Cursor config

For an installed npm package:

```json
{
  "mcpServers": {
    "debtlens": {
      "command": "npx",
      "args": ["-y", "debtlens", "mcp"]
    }
  }
}
```

For a local checkout:

```json
{
  "mcpServers": {
    "debtlens": {
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/absolute/path/to/DebtLens/src/cli/index.ts",
        "mcp"
      ]
    }
  }
}
```

## Tools

| Tool | Delegates to | Typical use |
| --- | --- | --- |
| `scan` | `debtlens scan --format json` | Ask an agent to scan the current workspace. |
| `doctor` | `debtlens doctor` | Debug config and file matching before a scan. |
| `rules` | `debtlens rules --format json` | Let an agent discover rule ids and descriptions. |
| `explain` | `debtlens explain <rule>` | Pull rule guidance and false-positive notes. |

## Verify

```bash
debtlens --version
debtlens doctor
```

The server requires Node.js 20 or newer, matching the CLI. It runs local commands only and
does not send source code to external services.
