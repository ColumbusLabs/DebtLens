# AI workflow drift examples

This fixture demonstrates duplicated and contradictory AI assistant instruction files.

Run:

```bash
debtlens scan examples/ai-workflow --pack ai-workflow-drift
```

Expected signals:

- `ai-instruction-duplication` for the repeated testing block in `AGENTS.md` and `CLAUDE.md`
- `ai-instruction-contradiction` for "always run tests" vs "skip tests"
