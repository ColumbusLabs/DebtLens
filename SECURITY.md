# Security Policy

DebtLens is a local static-analysis tool. It should not send source code to external services.

Please report vulnerabilities by opening a private security advisory on GitHub once the repository is published.

Security goals:

- Never transmit scanned code by default.
- Avoid executing scanned code.
- Avoid loading arbitrary project config as executable JavaScript.
- Prefer JSON config until a safe plugin model exists.
