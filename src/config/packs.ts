export interface RulePack {
  id: string;
  description: string;
  rules: string[];
  thresholds?: Record<string, number>;
}

const CORE_RULES = [
  "duplicate-logic",
  "large-function",
  "dead-abstraction",
  "duplicated-literal",
  "todo-comment",
  "naming-drift",
  "barrel-file",
  "weak-test-boundary",
  "api-surface-sprawl",
] as const;

const REACT_RULES = [
  ...CORE_RULES,
  "large-component",
  "state-sprawl",
  "effect-complexity",
  "hook-dependency-smell",
  "context-provider-sprawl",
  "prop-drilling",
  "story-only-component",
] as const;

const AI_ASSISTED_MAINTAINER_RULES = [
  "duplicate-logic",
  "duplicated-literal",
  "large-function",
  "dead-abstraction",
  "todo-comment",
  "naming-drift",
  "weak-test-boundary",
] as const;

const OSS_MAINTAINER_RULES = [
  "duplicate-logic",
  "duplicated-literal",
  "large-function",
  "dead-abstraction",
  "todo-comment",
  "barrel-file",
  "weak-test-boundary",
  "api-surface-sprawl",
] as const;

export const RULE_PACKS: Record<string, RulePack> = {
  core: {
    id: "core",
    description: "Core maintainability rules for any TypeScript or JavaScript project.",
    rules: [...CORE_RULES],
  },
  react: {
    id: "react",
    description: "Core rules plus React component, hook, and prop maintainability checks.",
    rules: [...REACT_RULES],
  },
  "react-native": {
    id: "react-native",
    description: "React rule pack for React Native apps (same rules; tune via propDrilling config).",
    rules: [...REACT_RULES],
    thresholds: {
      "prop-drilling.maxForwardedProps": 5,
      "context-provider-sprawl.maxProviders": 5,
    },
  },
  next: {
    id: "next",
    description: "React rule pack for Next.js apps with App Router boundary signals.",
    rules: [...REACT_RULES],
    thresholds: {
      "api-surface-sprawl.maxExports": 14,
      "barrel-file.maxReExports": 8,
    },
  },
  expo: {
    id: "expo",
    description: "React Native pack tuned for Expo Router projects.",
    rules: [...REACT_RULES],
    thresholds: {
      "prop-drilling.maxForwardedProps": 5,
      "context-provider-sprawl.maxProviders": 5,
      "barrel-file.maxReExports": 8,
    },
  },
  "ai-assisted-maintainer": {
    id: "ai-assisted-maintainer",
    description: "High-signal maintainability pack for assistant-heavy codebases; does not claim authorship detection.",
    rules: [...AI_ASSISTED_MAINTAINER_RULES],
    thresholds: {
      "duplicate-logic.minSimilarity": 0.88,
      "duplicated-literal.minCount": 4,
    },
  },
  "oss-maintainer": {
    id: "oss-maintainer",
    description: "Library-maintainer pack focused on public API shape, barrels, duplication, tests, and TODO debt.",
    rules: [...OSS_MAINTAINER_RULES],
    thresholds: {
      "api-surface-sprawl.maxExports": 10,
      "barrel-file.maxReExports": 5,
      "weak-test-boundary.allowTypeOnly": 1,
    },
  },
};

export const RULE_PACK_IDS = Object.keys(RULE_PACKS);

export function getRulePack(id: string): RulePack {
  const pack = RULE_PACKS[id];
  if (!pack) {
    throw new Error(`Unknown rule pack "${id}". Available: ${RULE_PACK_IDS.join(", ")}.`);
  }
  return pack;
}

export function listRulePacks(): RulePack[] {
  return RULE_PACK_IDS.map((id) => RULE_PACKS[id]!);
}
