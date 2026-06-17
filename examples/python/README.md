# Python Fixture

This fixture is for future Python language-pack experiments. The current DebtLens runtime
does not parse Python; use this directory to test adapter prototypes described in
[`docs/language-pack-rfc.md`](../../docs/language-pack-rfc.md).

Suggested future smoke command:

```bash
python -m debtlens_python_adapter --root examples/python --format json
```

The fixture includes:

- a thin wrapper that a future `python-dead-abstraction` rule should flag,
- repeated data-shaping logic for a future `python-duplicate-logic` rule,
- a tracked TODO comment for a future `python-todo-comment` rule,
- a parameterized test that duplication rules should not treat as copy-paste.

Expected future bounds when a Python pack is enabled:

| Rule | Min | Max | Notes |
| --- | ---: | ---: | --- |
| `python-duplicate-logic` | 1 | 2 | `normalize_invoice` and `normalize_receipt` share structure. |
| `python-dead-abstraction` | 1 | 1 | `render_invoice` only delegates. |
| `python-todo-comment` | 1 | 1 | One tracked TODO in `build_invoice_view`. |
