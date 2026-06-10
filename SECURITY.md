# Security Policy

DebtLens is a local static-analysis tool. It should not send source code to external services.

Please report vulnerabilities by opening a private security advisory on GitHub once the repository is published.

Security goals:

- Never transmit scanned code by default.
- Avoid executing scanned code.
- Avoid loading arbitrary project config as executable JavaScript.
- Prefer JSON config until a safe plugin model exists.

## Plugins

Config-listed plugins (`plugins` in `debtlens.config.json`) are local ESM modules that
execute with the CLI's privileges. Treat them like any other code in the repository:
only enable them in trusted pipelines. Plugin paths must stay within the config file's
directory tree, and no code is loaded from config values other than the explicit
`plugins` list (see [`docs/plugin-api-rfc.md`](./docs/plugin-api-rfc.md)).

CI environments scanning untrusted repositories can set `DEBTLENS_DISABLE_PLUGINS=1`
to skip plugin loading entirely; built-in rules still run and a single note is written
to stderr when configured plugins are skipped.
