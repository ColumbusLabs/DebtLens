import type { DebtLensConfig } from "../core/types.js";

export const defaultConfig: Required<DebtLensConfig> = {
  include: ["**/*.{ts,tsx,js,jsx}"],
  exclude: [
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".next/**",
    ".expo/**",
    ".turbo/**",
    "ios/**",
    "android/**",
    "**/*.d.ts",
    "**/*.min.js",
    "**/*.test.{ts,tsx,js,jsx}",
    "**/*.spec.{ts,tsx,js,jsx}",
    "**/__tests__/**",
    "**/__mocks__/**"
  ],
  minSeverity: "low",
  rules: [],
  thresholds: {
    "large-component.maxLines": 250,
    "large-component.maxBranches": 16,
    "large-component.maxHooks": 10,
    "state-sprawl.maxStatefulHooks": 6,
    "effect-complexity.maxLines": 30,
    "effect-complexity.maxDependencies": 8,
    "duplicate-logic.minSimilarity": 0.86,
    "duplicate-logic.minLines": 8,
    "duplicate-logic.maxSnippets": 450,
    "dead-abstraction.maxWrapperLines": 8,
    "prop-drilling.maxForwardedProps": 4,
    "naming-drift.minVariants": 4,
    "duplicate-logic.minStructuralSimilarity": 0.6
  },
  maxFiles: 2000,
  vocabulary: {},
};
