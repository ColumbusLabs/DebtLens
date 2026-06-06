import type { DebtLensConfig } from "../core/types.js";
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
    "state-sprawl",
    "effect-complexity",
    "duplicate-logic",
    "dead-abstraction",
    "prop-drilling",
    "todo-comment",
    "naming-drift",
  ],
  thresholds: {
    "large-component.maxLines": 250,
    "state-sprawl.maxStatefulHooks": 6,
    "effect-complexity.maxLines": 30,
    "duplicate-logic.minSimilarity": 0.86,
    "duplicate-logic.minLines": 8,
  },
};

export function renderConfigFile(pack?: string): string {
  if (pack) {
    const { rules: _rules, ...base } = configTemplate;
    return `${JSON.stringify({ ...base, pack }, null, 2)}\n`;
  }

  return `${JSON.stringify(configTemplate, null, 2)}\n`;
}
