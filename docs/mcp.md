# MCP Server

DebtLens ships a stdio MCP server for agents and editors that can call Model Context
Protocol tools. It delegates to the same scanner and CLI helpers maintainers already use,
so the results match local DebtLens workflows while returning agent-friendly structured
content where possible.

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

Claude Desktop, Codex, and other MCP clients use the same command/args shape when they
accept stdio MCP server entries. Point `command` at `npx` for the published package or at
`node` with `--import tsx` for a local checkout, then ask the agent to call the named
DebtLens tools instead of shelling out manually.

## Tools

| Tool | Delegates to | Typical use |
| --- | --- | --- |
| `scan` | `debtlens scan --format json` | Ask an agent to scan the current workspace. |
| `doctor` | `debtlens doctor` | Debug config and file matching before a scan. |
| `rules` | `debtlens rules --format json` | Let an agent discover rule ids and descriptions. |
| `explain` | `debtlens explain <rule>` | Pull rule guidance and false-positive notes. |
| `adopt` | `debtlens adopt` dry run | Build a first-run rollout plan without writing config or baseline files. |
| `compare` | `debtlens compare` | Compare two ScanResult JSON files without rescanning. |
| `suppress` | `debtlens suppress` | Generate auditable inline suppression directives with rule/reason metadata. |
| `baseline_diff` | `debtlens baseline diff --format json` | Preview baseline drift without writing files. |
| `baseline_prune_preview` | `debtlens baseline prune --dry-run --format json` | Preview a baseline prune without writing files. |

Tool results keep the standard MCP text content shape (`content[0].text`) for compatibility.
Clients that negotiate MCP protocol `2025-06-18` also receive workflow
`structuredContent` so agents can plan without scraping text:

- `adopt`: scan summary, recommended `minSeverity`, threshold suggestions, rollout plan, and `dryRun: true`.
- `compare`: total/severity/rule deltas, exact new/resolved counts when issue arrays are present, top new files, and warnings.
- `suppress`: directive text, suppression kind, normalized rule id, and reason.
- `baseline_diff` and `baseline_prune_preview`: JSON baseline delta, new issues, resolved fingerprints, changed issues, and `wroteBaseline: false`.

## Agent examples

Ask an agent to plan a low-risk rollout:

```text
Use the DebtLens MCP `doctor` tool on this workspace, then run `adopt` with `rules:
todo-comment` and summarize the rollout plan. Do not write files.
```

Compare scheduled JSON artifacts:

```text
Use the DebtLens MCP `compare` tool with `previous: previous/debtlens-report.json`,
`current: current/debtlens-report.json`, and `format: markdown`. Include any warnings
about mismatched scan scope.
```

Generate a suppression only after review:

```text
Use the DebtLens MCP `explain` tool for `todo-comment`, decide whether the finding is
intentional, then use `suppress` with a ticket-backed reason.
```

## Trust boundaries

The MCP server runs local code in the repository where the agent points it. Built-in MCP
handlers do not intentionally write repository files or send source code to external
services. However, scan, adopt, doctor, and baseline preview workflows can load configured
plugins; plugin modules execute as trusted local code and may perform arbitrary IO or
network operations. Use `DEBTLENS_DISABLE_PLUGINS=1` for untrusted repositories.

`adopt` is always a dry run through MCP, and baseline tools are preview-only; they do not
prune or update baseline files.

## Verify

```bash
debtlens --version
debtlens doctor
```

The server requires Node.js 20 or newer, matching the CLI.
