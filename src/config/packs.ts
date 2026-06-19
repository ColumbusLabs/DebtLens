import type { SourceLanguage } from "../core/types.js";

export interface RulePack {
  id: string;
  description: string;
  rules: string[];
  languages: SourceLanguage[];
  thresholds?: Record<string, number>;
  duplicatedLiteral?: {
    ignoreStrings?: string[];
  };
}

const CORE_RULES = [
  "duplicate-logic",
  "test-duplication",
  "large-function",
  "complex-control-flow",
  "import-cycle",
  "config-drift",
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

const REACT_NATIVE_RULES = [
  ...REACT_RULES,
  "rn-host-forwarding",
] as const;

const NEXT_RULES = [
  ...REACT_RULES,
  "server-client-boundary",
  "route-handler-size",
  "data-loader-sprawl",
] as const;

const NODE_RULES = [
  ...CORE_RULES,
  "handler-depth",
  "route-sprawl",
] as const;

const AI_ASSISTED_MAINTAINER_RULES = [
  "duplicate-logic",
  "duplicated-literal",
  "large-function",
  "dead-abstraction",
  "todo-comment",
  "naming-drift",
  "weak-test-boundary",
  "test-duplication",
] as const;

const OSS_MAINTAINER_RULES = [
  "duplicate-logic",
  "duplicated-literal",
  "large-function",
  "dead-abstraction",
  "todo-comment",
  "barrel-file",
  "weak-test-boundary",
  "test-duplication",
  "api-surface-sprawl",
] as const;

const PYTHON_RULES = [
  "python-duplicate-logic",
  "python-dead-abstraction",
  "python-todo-comment",
] as const;

const KOTLIN_RULES = [
  "kotlin-duplicate-logic",
  "kotlin-large-function",
  "kotlin-dead-abstraction",
  "kotlin-todo-comment",
] as const;

const COMPOSE_RULES = [
  "compose-large-composable",
  "compose-state-hoisting",
] as const;

export const RULE_PACKS: Record<string, RulePack> = {
  core: {
    id: "core",
    description: "Core maintainability rules for any TypeScript or JavaScript project.",
    rules: [...CORE_RULES],
    languages: ["tsjs"],
  },
  react: {
    id: "react",
    description: "Core rules plus React component, hook, and prop maintainability checks.",
    rules: [...REACT_RULES],
    languages: ["tsjs"],
  },
  "react-native": {
    id: "react-native",
    description: "React rule pack for React Native apps with host-primitive forwarding signals.",
    rules: [...REACT_NATIVE_RULES],
    languages: ["tsjs"],
    thresholds: {
      "prop-drilling.maxForwardedProps": 5,
      "context-provider-sprawl.maxProviders": 5,
      "rn-host-forwarding.maxForwardedProps": 6,
    },
  },
  next: {
    id: "next",
    description: "React rule pack for Next.js apps with App Router boundary signals.",
    rules: [...NEXT_RULES],
    languages: ["tsjs"],
    duplicatedLiteral: {
      ignoreStrings: ["use client", "use server"],
    },
    thresholds: {
      "api-surface-sprawl.maxExports": 14,
      "barrel-file.maxReExports": 8,
    },
  },
  expo: {
    id: "expo",
    description: "React Native pack tuned for Expo Router projects.",
    rules: [...REACT_NATIVE_RULES],
    languages: ["tsjs"],
    thresholds: {
      "prop-drilling.maxForwardedProps": 5,
      "context-provider-sprawl.maxProviders": 5,
      "barrel-file.maxReExports": 8,
      "rn-host-forwarding.maxForwardedProps": 6,
    },
  },
  node: {
    id: "node",
    description: "Core rules plus Express/Fastify route depth and route-count checks for Node APIs.",
    rules: [...NODE_RULES],
    languages: ["tsjs"],
    thresholds: {
      "handler-depth.maxDepth": 4,
      "route-sprawl.maxRoutes": 8,
    },
  },
  python: {
    id: "python",
    description: "Core Python maintainability rules for duplicate functions, thin wrappers, and debt comments.",
    rules: [...PYTHON_RULES],
    languages: ["python"],
  },
  kotlin: {
    id: "kotlin",
    description: "Core Kotlin maintainability rules for duplicate functions, large functions, thin wrappers, and debt comments.",
    rules: [...KOTLIN_RULES],
    languages: ["kotlin"],
  },
  compose: {
    id: "compose",
    description: "Jetpack Compose UI maintainability rules for oversized composables and local state-hoisting smells.",
    rules: [...COMPOSE_RULES],
    languages: ["kotlin"],
  },
  "ai-assisted-maintainer": {
    id: "ai-assisted-maintainer",
    description: "High-signal maintainability pack for assistant-heavy codebases; does not claim authorship detection.",
    rules: [...AI_ASSISTED_MAINTAINER_RULES],
    languages: ["tsjs"],
    thresholds: {
      "duplicate-logic.minSimilarity": 0.88,
      "duplicated-literal.minCount": 4,
    },
  },
  "oss-maintainer": {
    id: "oss-maintainer",
    description: "Library-maintainer pack focused on public API shape, barrels, duplication, tests, and TODO debt.",
    rules: [...OSS_MAINTAINER_RULES],
    languages: ["tsjs"],
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
