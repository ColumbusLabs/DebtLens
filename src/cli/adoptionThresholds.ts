import type { ScanOptions, ScanResult } from "../core/types.js";

export interface ThresholdSuggestion {
  key: string;
  current: number;
  suggested: number;
  observedP90: number;
  samples: number;
  observedValues?: number[];
}

export interface CalibrationMetric {
  key: string;
  ruleIds: readonly string[];
  source: "evidence" | "message";
  pattern: RegExp;
}

export interface CalibrationDiagnostic {
  key: string;
  ruleIds: readonly string[];
  reason: string;
}

const metric = (key: string, ruleIds: string | readonly string[], source: "evidence" | "message", pattern: RegExp): CalibrationMetric => ({
  key, ruleIds: typeof ruleIds === "string" ? [ruleIds] : ruleIds, source, pattern,
});

export const calibrationMetrics: readonly CalibrationMetric[] = [
  metric("large-component.maxLines", "large-component", "evidence", /^Lines: (\d+)\b/),
  metric("large-component.maxHooks", "large-component", "evidence", /^Hook calls: (\d+)\b/),
  metric("large-component.maxBranches", "large-component", "evidence", /^Branch points: (\d+)\b/),
  metric("large-function.maxLines", ["large-function", "python-large-function", "kotlin-large-function", "swift-large-function", "ruby-large-function"], "evidence", /^Lines: (\d+)\b/),
  metric("large-function.maxBranches", ["large-function", "python-large-function", "kotlin-large-function", "swift-large-function", "ruby-large-function"], "evidence", /^Branch points: (\d+)\b/),
  metric("effect-complexity.maxLines", "effect-complexity", "evidence", /^Lines: (\d+)\b/),
  metric("effect-complexity.maxDependencies", "effect-complexity", "evidence", /^Dependencies: (\d+)\b/),
  metric("state-sprawl.maxStatefulHooks", "state-sprawl", "message", /manages (\d+) stateful hook calls/),
  metric("prop-drilling.maxForwardedProps", "prop-drilling", "message", /forwards (\d+) props/),
  metric("context-provider-sprawl.maxProviders", "context-provider-sprawl", "message", /wraps children in (\d+) distinct/),
  metric("rn-host-forwarding.maxForwardedProps", "rn-host-forwarding", "message", /forwards (\d+) wrapper props/),
  metric("rn-host-forwarding.maxHostTargets", "rn-host-forwarding", "message", /into (\d+) host/),
  metric("route-handler-size.maxLines", "route-handler-size", "evidence", /^Lines: (\d+)\b/),
  metric("route-handler-size.maxBranches", "route-handler-size", "evidence", /^Branch points: (\d+)\b/),
  metric("route-handler-size.maxAwaits", "route-handler-size", "evidence", /^Await expressions: (\d+)\b/),
  metric("data-loader-sprawl.maxLines", "data-loader-sprawl", "evidence", /^Lines: (\d+)\b/),
  metric("data-loader-sprawl.maxBranches", "data-loader-sprawl", "evidence", /^Branch points: (\d+)\b/),
  metric("data-loader-sprawl.maxAwaits", "data-loader-sprawl", "evidence", /^Await expressions: (\d+)\b/),
  metric("data-loader-sprawl.maxFetches", "data-loader-sprawl", "evidence", /^Fetch calls: (\d+)\b/),
  metric("handler-depth.maxDepth", "handler-depth", "evidence", /^(?:Control depth|Nested callbacks): (\d+)\b/),
  metric("handler-depth.maxMiddleware", "handler-depth", "evidence", /^Middleware arguments: (\d+)\b/),
  metric("route-sprawl.maxRoutes", "route-sprawl", "message", /registers (\d+) routes/),
  metric("python-route-sprawl.maxRoutes", "python-route-sprawl", "message", /registers (\d+) routes/),
  metric("rails-route-sprawl.maxRoutes", "rails-route-sprawl", "message", /registers (\d+) Rails routes/),
  metric("rails-controller-sprawl.maxActions", "rails-controller-sprawl", "message", /declares (\d+) public controller actions/),
  metric("barrel-file.maxReExports", "barrel-file", "message", /with (\d+) (?:re-)?exports?/),
  metric("api-surface-sprawl.maxExports", "api-surface-sprawl", "evidence", /^Exports: (\d+)\b/),
  metric("complex-control-flow.maxComplexity", ["complex-control-flow", "python-complex-control-flow"], "evidence", /^(?:Complexity score|Cyclomatic complexity): (\d+)\b/),
  metric("complex-control-flow.maxDepth", ["complex-control-flow", "python-complex-control-flow"], "evidence", /^(?:Max nesting depth|Control-flow depth): (\d+)\b/),
  metric("cognitive-complexity.max", "cognitive-complexity", "evidence", /^Cognitive complexity: (\d+)\b/),
  metric("long-parameter-list.maxParams", "long-parameter-list", "evidence", /^Parameters: (\d+)\b/),
  metric("long-parameter-list.maxBooleans", "long-parameter-list", "evidence", /^Boolean parameters: (\d+)\b/),
  metric("god-file.maxLines", "god-file", "evidence", /^Lines: (\d+)\b/),
  metric("god-file.maxExports", "god-file", "evidence", /^Exports: (\d+)\b/),
  metric("god-file.maxTopLevelDecls", "god-file", "evidence", /^Top-level declarations: (\d+)\b/),
  metric("naming-drift.minVariants", "naming-drift", "message", /uses (\d+) competing terms/),
  metric("vue-large-script.maxLines", "vue-large-script", "evidence", /^Script lines: (\d+)\b/),
  metric("vue-large-script.maxFunctionLines", "vue-large-script", "evidence", /^Lines: (\d+)\b/),
  metric("vue-large-script.maxBranches", "vue-large-script", "evidence", /^Branch points: (\d+)\b/),
  metric("svelte-large-script.maxLines", "svelte-large-script", "evidence", /^Script lines: (\d+)\b/),
  metric("svelte-large-script.maxFunctionLines", "svelte-large-script", "evidence", /^Lines: (\d+)\b/),
  metric("svelte-large-script.maxBranches", "svelte-large-script", "evidence", /^Branch points: (\d+)\b/),
  ...["compose-large-composable", "swiftui-large-view"].flatMap((ruleId) => [
    metric(`${ruleId}.maxLines`, ruleId, "evidence", /(?:^|: )(\d+) lines\b/i),
    metric(`${ruleId}.maxBranches`, ruleId, "evidence", /(\d+) branch points\b/i),
  ]),
  metric("compose-large-composable.maxLocalState", "compose-large-composable", "evidence", /(\d+) local state holders\b/i),
  metric("swiftui-large-view.maxLocalState", "swiftui-large-view", "evidence", /(\d+) local state holders\b/i),
  metric("compose-state-hoisting.maxLocalState", "compose-state-hoisting", "message", /owns (\d+) local/),
  metric("swiftui-state-sprawl.maxStateHolders", "swiftui-state-sprawl", "message", /owns (\d+) local/),
] as const;

const diagnostic = (key: string, ruleIds: string | readonly string[], reason: string): CalibrationDiagnostic => ({
  key, ruleIds: typeof ruleIds === "string" ? [ruleIds] : ruleIds, reason,
});

const duplicateRules = ["duplicate-logic", "python-duplicate-logic", "kotlin-duplicate-logic", "swift-duplicate-logic", "ruby-duplicate-logic"] as const;
const deadRules = ["dead-abstraction", "python-dead-abstraction", "kotlin-dead-abstraction", "swift-dead-abstraction", "ruby-dead-abstraction"] as const;
export const calibrationDiagnostics: readonly CalibrationDiagnostic[] = [
  diagnostic("god-file.minAxes", "god-file", "minimum multi-axis trigger is a rule policy, not a repository distribution"),
  ...["minSimilarity", "minStructuralSimilarity", "minLines", "maxSnippets"].map((name) => diagnostic(`duplicate-logic.${name}`, duplicateRules, "similarity/corpus controls cannot be inferred from emitted findings")),
  ...["minSimilarity", "minStructuralSimilarity", "minLines"].map((name) => diagnostic(`test-duplication.${name}`, "test-duplication", "similarity controls cannot be inferred from emitted findings")),
  diagnostic("dead-abstraction.maxWrapperLines", deadRules, "wrapper size is only meaningful after semantic wrapper classification"),
  diagnostic("duplicated-literal.minLength", "duplicated-literal", "minimum token length is a policy floor"),
  diagnostic("duplicated-literal.minCount", "duplicated-literal", "minimum repetition count is a policy floor"),
  diagnostic("config-drift.maxConfigFiles", "config-drift", "repository safety cap is not an observed finding metric"),
  diagnostic("import-cycle.minCycleSize", "import-cycle", "minimum cycle size is a policy floor"),
  diagnostic("import-cycle.allowTypeOnly", "import-cycle", "boolean behavior switch is not calibratable"),
  diagnostic("weak-test-boundary.allowTypeOnly", "weak-test-boundary", "boolean behavior switch is not calibratable"),
  diagnostic("empty-catch.allowCommentOnly", ["empty-catch", "python-error-handling", "kotlin-empty-catch"], "boolean behavior switch is not calibratable"),
  diagnostic("floating-promise.allowVoid", "floating-promise", "boolean behavior switch is not calibratable"),
  diagnostic("floating-promise.maxPerFile", "floating-promise", "per-file reporting cap is not a trigger distribution"),
  diagnostic("commented-out-code.minLines", "commented-out-code", "minimum block size is a policy floor"),
  diagnostic("commented-out-code.maxPerFile", "commented-out-code", "per-file reporting cap is not a trigger distribution"),
  diagnostic("ai-instruction-duplication.maxInstructionFiles", "ai-instruction-duplication", "repository safety cap is not an observed finding metric"),
  diagnostic("ai-instruction-duplication.minBlockLength", "ai-instruction-duplication", "minimum text length is a policy floor"),
  diagnostic("ai-instruction-contradiction.maxInstructionFiles", "ai-instruction-contradiction", "repository safety cap is not an observed finding metric"),
  diagnostic("ai-instruction-contradiction.minBlockLength", "ai-instruction-contradiction", "minimum text length is a policy floor"),
] as const;

export const calibrationThresholdKeys = calibrationMetrics.map((entry) => entry.key);

export function calibrationThresholdOverrides(selectedRules?: readonly string[]): Record<string, number> {
  const selected = selectedRules ? new Set(selectedRules) : undefined;
  const entries = calibrationMetrics.filter((entry) => !selected || entry.ruleIds.some((ruleId) => selected.has(ruleId)));
  const overrides = Object.fromEntries(entries.map((entry) => [entry.key, 0]));
  if (!selected || selected.has("god-file")) overrides["god-file.minAxes"] = 1;
  return overrides;
}

export function calibrationDiagnosticsForRules(selectedRules?: readonly string[]): CalibrationDiagnostic[] {
  const selected = selectedRules ? new Set(selectedRules) : undefined;
  return calibrationDiagnostics.filter((entry) => !selected || entry.ruleIds.some((ruleId) => selected.has(ruleId)));
}

export function collectThresholdObservations(result: ScanResult): Map<string, number[]> {
  const observed = new Map<string, number[]>();
  for (const issue of result.issues) {
    for (const entry of calibrationMetrics) {
      if (!entry.ruleIds.includes(issue.ruleId)) continue;
      const values = entry.source === "message" ? [issue.message] : issue.evidence ?? [];
      for (const value of values) {
        const match = value.match(entry.pattern);
        if (match?.[1]) pushObserved(observed, entry.key, Number(match[1]));
      }
    }
  }
  return observed;
}

export function buildThresholdSuggestions(result: ScanResult, options: ScanOptions): ThresholdSuggestion[] {
  return [...collectThresholdObservations(result).entries()]
    .map(([key, values]) => {
      const current = options.thresholds[key] ?? 0;
      const observedP90 = percentile(values, 0.9);
      const suggested = Math.max(Math.ceil(observedP90 * 1.1), Math.ceil(current));
      return { key, current, suggested, observedP90, samples: values.length, observedValues: [...values] };
    })
    .filter((suggestion) => suggestion.current > 0 && suggestion.suggested > suggestion.current)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function pushObserved(observed: Map<string, number[]>, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const values = observed.get(key);
  if (values) values.push(value);
  else observed.set(key, [value]);
}

function percentile(values: number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * quantile) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}
