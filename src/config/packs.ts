export interface RulePack {
  id: string;
  description: string;
  rules: string[];
}

const CORE_RULES = [
  "duplicate-logic",
  "dead-abstraction",
  "todo-comment",
  "naming-drift",
] as const;

const REACT_RULES = [
  ...CORE_RULES,
  "large-component",
  "state-sprawl",
  "effect-complexity",
  "prop-drilling",
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
  },
  next: {
    id: "next",
    description: "React rule pack for Next.js apps (Next-specific detectors deferred).",
    rules: [...REACT_RULES],
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
