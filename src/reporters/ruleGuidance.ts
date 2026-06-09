const ruleReviewPrompts: Record<string, string> = {
  "large-component": "Can this component be split by feature boundary without changing behavior? List one extraction candidate.",
  "state-sprawl": "Which state variables change together? Could a reducer or domain hook replace independent useState calls?",
  "effect-complexity": "Does this effect do one job? If not, what is the smallest split that preserves behavior?",
  "duplicate-logic": "Are both copies intentional? If not, which copy should become canonical and what breaks if you merge them?",
  "dead-abstraction": "Does this wrapper enforce a boundary today? If not, inline it or add the missing behavior.",
  "prop-drilling": "Can data ownership move closer to consumers via composition, context, or a colocated hook?",
  "todo-comment": "Is there a tracked issue and removal condition? If not, create one or fix the debt now.",
  "naming-drift": "Which term should be canonical for this concept? Where should adapters translate legacy names?",
};

export function getReviewPrompt(ruleId: string): string | undefined {
  return ruleReviewPrompts[ruleId];
}
