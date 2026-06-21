# AI Workflow Instruction Drift RFC

Status: **Prototype shipped (`ai-workflow-drift` pack)**

DebtLens teams increasingly maintain parallel instruction files for coding assistants:
`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, and `.github/copilot-instructions.md`.
Those files drift apart quickly, producing contradictory guidance for humans and agents.

This pack adds conservative, local checks for duplicated and conflicting instruction text.
It is a maintainability scanner extension, not an authorship detector.

## Target files

The pack scans repository-local instruction surfaces only:

| Path pattern | Purpose |
| --- | --- |
| `AGENTS.md` | Repository agent instructions (Cursor, Codex, and similar tools) |
| `CLAUDE.md` | Claude Code / Claude project instructions |
| `.github/copilot-instructions.md` | GitHub Copilot repository instructions |
| `.cursor/rules/**` (`*.md`, `*.mdc`) | Cursor rule files |

Detectors resolve files from the scan `context.files` list and, when needed, walk the
scan target on disk (similar to `config-drift` JSON discovery).

## Non-goals

- **Does not detect AI-authored code.** The pack inspects instruction markdown only.
- **No external telemetry.** Analysis stays on the local filesystem during `debtlens scan`.
- **No semantic policy enforcement.** The MVP uses normalized text duplication and a small
  set of conservative contradiction patterns (for example, "always run tests" vs "skip tests").
- **No secret scanning.** Instruction files may contain credentials; this pack does not
  upload, index, or phone home file contents.

## Prototype rules

| Rule id | Signal |
| --- | --- |
| `ai-instruction-duplication` | The same normalized instruction block appears in two or more target files |
| `ai-instruction-contradiction` | Conservative opposing directives appear across instruction files |

## File discovery model

The `ai-workflow-drift` pack declares `includeGlobs` for the instruction paths above.
`mergeConfig()` unions those globs into scan discovery when the pack is selected, while
detectors still filter `context.files` by instruction path patterns inside `detect()`.

Example:

```bash
debtlens scan examples/ai-workflow --pack ai-workflow-drift
```

## Privacy and security considerations

- **Local-only analysis:** DebtLens reads files from the scan target and optional git
  staged overrides; it does not transmit instruction text to third-party services.
- **Sensitive content risk:** Instruction files sometimes embed API keys, internal URLs,
  or customer names. Treat scan artifacts (JSON, SARIF, Markdown reports) like source
  code output and restrict CI artifact retention when needed.
- **Conservative contradictions:** The contradiction rule intentionally under-reports to
  avoid blocking legitimate tool-specific nuance. Review findings; do not treat them as
  policy violations without human confirmation.
- **No provenance claims:** Findings describe instruction drift, not whether code was
  written by an assistant.

## Future direction

- Optional `includeGlobs` overrides per repository config
- Richer contradiction templates with configurable vocabulary
- Cross-link suggestions to a canonical `AGENTS.md`
- Pack composition with `ai-assisted-maintainer` for code maintainability plus instruction drift

Track implementation in [#214](https://github.com/ColumbusLabs/DebtLens/issues/214).
