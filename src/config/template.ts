import type { DebtLensConfig } from "../core/types.js";
import { getRulePack } from "./packs.js";
import { SCHEMA_ID } from "./schema.js";

/**
 * Canonical starter config written by `debtlens init`. Kept in code (not read from
 * the repo's example file) so it works when DebtLens is installed from npm, where
 * only `dist/`, `README`, `LICENSE`, and `docs/` are published.
 */
export const configTemplate: DebtLensConfig & { $schema: string } = {
  $schema: SCHEMA_ID,
  include: ["src/**/*.{ts,tsx,js,jsx}"],
  exclude: ["node_modules/**", "dist/**", "build/**", ".next/**", "coverage/**"],
  minSeverity: "low",
  respectGitignore: false,
  rules: [
    "large-component",
    "large-function",
    "state-sprawl",
    "effect-complexity",
    "hook-dependency-smell",
    "context-provider-sprawl",
    "rn-host-forwarding",
    "server-client-boundary",
    "route-handler-size",
    "data-loader-sprawl",
    "handler-depth",
    "route-sprawl",
    "duplicate-logic",
    "test-duplication",
    "complex-control-flow",
    "import-cycle",
    "config-drift",
    "duplicated-literal",
    "dead-abstraction",
    "prop-drilling",
    "todo-comment",
    "naming-drift",
    "barrel-file",
    "weak-test-boundary",
    "api-surface-sprawl",
    "story-only-component",
  ],
  thresholds: {
    "large-component.maxLines": 250,
    "large-function.maxLines": 120,
    "state-sprawl.maxStatefulHooks": 6,
    "effect-complexity.maxLines": 30,
    "context-provider-sprawl.maxProviders": 4,
    "rn-host-forwarding.maxForwardedProps": 6,
    "route-handler-size.maxAwaits": 6,
    "data-loader-sprawl.maxFetches": 5,
    "handler-depth.maxDepth": 4,
    "route-sprawl.maxRoutes": 8,
    "duplicate-logic.minSimilarity": 0.86,
    "duplicate-logic.minLines": 8,
    "test-duplication.minSimilarity": 0.88,
    "complex-control-flow.maxComplexity": 12,
    "import-cycle.minCycleSize": 2,
    "duplicated-literal.minCount": 3,
    "barrel-file.maxReExports": 6,
    "api-surface-sprawl.maxExports": 12,
  },
};

export function renderConfigFile(pack?: string, thresholdOverrides: Record<string, number> = {}): string {
  if (pack) {
    const { rules: _rules, ...base } = configTemplate;
    const rulePack = getRulePack(pack);
    return `${JSON.stringify({
      ...base,
      pack,
      thresholds: { ...base.thresholds, ...(rulePack.thresholds ?? {}), ...thresholdOverrides },
    }, null, 2)}\n`;
  }

  return `${JSON.stringify({
    ...configTemplate,
    thresholds: { ...configTemplate.thresholds, ...thresholdOverrides },
  }, null, 2)}\n`;
}
