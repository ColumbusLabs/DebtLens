# Feature-flag debt RFC

Status: shipped with the opt-in `feature-flags` pack.

## Contract

The `stale-feature-flag` rule recognizes two conservative sources of flag identity:

1. top-level boolean constants whose names match `featureFlags.constantNamePatterns`; and
2. boolean properties or top-level boolean constants in files matched by
   `featureFlags.registryGlobs` (paths are relative to the scan target).

Configured access patterns identify registry keys read through a call. `callee` is the
exact source-level callee text and `keyArgument` is a zero-based argument index. Only
string literals and no-substitution template literals are treated as keys.

```json
{
  "pack": "feature-flags",
  "featureFlags": {
    "accessPatterns": [
      { "callee": "isEnabled", "keyArgument": 0 },
      { "callee": "featureClient.enabled", "keyArgument": 1 }
    ],
    "registryGlobs": ["src/flags.ts", "packages/*/src/flags/**"],
    "constantNamePatterns": ["^(?:enable|disable)[A-Z]"]
  }
}
```

`accessPatterns` and `constantNamePatterns` replace their defaults when configured;
`registryGlobs` extend across root and package configuration. Supported glob operators
are `*`, `**`, and `?`. Defaults recognize `isEnabled(key)`, `useFlag(key)`, and
`flags(key)`, plus common flag-like top-level constant names. The rule remains opt-in.

## Findings

- A literal boolean definition is always-on/off only when its identifier, property, or
  configured literal-key access participates in conditional control flow.
- A configured registry entry is unreferenced only after all scanned files are
  aggregated. Cross-file constant references therefore do not become false unused
  findings.
- If a configured access call uses a dynamic key, unreferenced-registry findings are
  suppressed for that scan because the detector cannot prove which entry it reads.

## Non-goals

- No flag-provider SDK is inferred without configuration.
- No dynamic key, computed registry property, remote rollout state, flag age, or rollout
  percentage is resolved.
- No dead branch is rewritten automatically.
- Registry formats other than TS/JS boolean constants and object properties are not
  parsed in this version.

These limits favor missed findings over noisy cleanup advice. Add project-specific
patterns instead of broadening names globally.
