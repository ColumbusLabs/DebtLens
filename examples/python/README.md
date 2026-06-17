# Python Fixture

This fixture calibrates the built-in Python language pack. DebtLens scans it only when the
`python` pack or explicit `python-*` rules are selected.

Smoke command:

```bash
npx debtlens scan examples/python --pack python --format json
```

The fixture includes:

- a thin wrapper that `python-dead-abstraction` should flag,
- repeated data-shaping logic for `python-duplicate-logic`,
- a tracked TODO comment for `python-todo-comment`,
- a parameterized test that duplication rules should not treat as copy-paste.

Expected bounds when the Python pack is enabled:

| Rule | Min | Max | Notes |
| --- | ---: | ---: | --- |
| `python-duplicate-logic` | 1 | 2 | `normalize_invoice` and `normalize_receipt` share structure. |
| `python-dead-abstraction` | 1 | 1 | `render_invoice` only delegates. |
| `python-todo-comment` | 1 | 1 | One tracked TODO in `build_invoice_view`. |
