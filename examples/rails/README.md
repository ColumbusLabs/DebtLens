# Calibrated Rails framework-pack fixture for DebtLens.

Run with:

```bash
debtlens scan examples/rails --pack rails --min-severity info
```

This fixture intentionally triggers:

- `rails-route-sprawl` in `config/routes.rb`
- `rails-controller-sprawl` in `app/controllers/accounts_controller.rb`

Ruby core rules are also available when scanning service objects with `--pack ruby` or the combined `rails` pack.
