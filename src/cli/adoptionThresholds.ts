import type { ScanOptions, ScanResult } from "../core/types.js";

export interface ThresholdSuggestion {
  key: string;
  current: number;
  suggested: number;
  observedP90: number;
  samples: number;
}

interface EvidenceThreshold {
  key: string;
  pattern: RegExp;
  ruleId?: string;
}

const evidenceThresholds: EvidenceThreshold[] = [
  { key: "large-component.maxLines", pattern: /^Lines: (\d+) \// },
  { key: "large-component.maxHooks", pattern: /^Hook calls: (\d+) \// },
  { key: "large-component.maxBranches", pattern: /^Branch points: (\d+) \// },
  { key: "effect-complexity.maxLines", pattern: /^Lines: (\d+) \//, ruleId: "effect-complexity" },
  { key: "effect-complexity.maxDependencies", pattern: /^Dependencies: (\d+) \// },
] as const;

export function buildThresholdSuggestions(result: ScanResult, options: ScanOptions): ThresholdSuggestion[] {
  const observed = new Map<string, number[]>();

  for (const issue of result.issues) {
    for (const evidence of issue.evidence ?? []) {
      for (const threshold of evidenceThresholds) {
        if (threshold.ruleId && threshold.ruleId !== issue.ruleId) continue;
        if (!threshold.ruleId && threshold.key.startsWith("large-component.") && issue.ruleId !== "large-component") continue;
        const match = evidence.match(threshold.pattern);
        if (!match) continue;
        pushObserved(observed, threshold.key, Number(match[1]));
      }
    }

    if (issue.ruleId === "state-sprawl") {
      const count = issue.message.match(/manages (\d+) stateful hook calls/)?.[1];
      if (count) pushObserved(observed, "state-sprawl.maxStatefulHooks", Number(count));
    }
    if (issue.ruleId === "prop-drilling") {
      const count = issue.message.match(/forwards (\d+) props/)?.[1];
      if (count) pushObserved(observed, "prop-drilling.maxForwardedProps", Number(count));
    }
  }

  return [...observed.entries()]
    .map(([key, values]) => {
      const current = options.thresholds[key];
      const observedP90 = percentile(values, 0.9);
      const suggested = Math.max(Math.ceil(observedP90 * 1.1), Math.ceil(current ?? 0));
      return { key, current: current ?? 0, suggested, observedP90, samples: values.length };
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
