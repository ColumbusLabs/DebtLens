import { buildThresholdSuggestions, type ThresholdSuggestion } from "../cli/adoptionThresholds.js";
import type { ScanOptions, ScanResult } from "../core/types.js";

export interface CalibrateOptions {
  percentile: number;
}

export interface CalibrateResult {
  suggestions: ThresholdSuggestion[];
  percentile: number;
}

export function buildCalibrateSuggestions(
  result: ScanResult,
  options: ScanOptions,
  calibrateOptions: CalibrateOptions,
): CalibrateResult {
  const base = buildThresholdSuggestions(result, options);
  const percentile = clampPercentile(calibrateOptions.percentile);
  const suggestions = base.map((suggestion) => {
    const observed = percentileValue(suggestion.observedValues ?? [suggestion.observedP90], percentile / 100);
    const suggested = Math.max(Math.ceil(observed * 1.05), Math.ceil(suggestion.current));
    return {
      ...suggestion,
      observedP90: observed,
      suggested,
    };
  });
  return { suggestions, percentile };
}

export function renderCalibrateReport(result: CalibrateResult): string {
  if (result.suggestions.length === 0) {
    return `No threshold suggestions at the p${result.percentile} percentile. Current defaults already match observed distributions.\n`;
  }
  const lines = [
    `DebtLens calibrate (p${result.percentile})`,
    "",
    "Threshold".padEnd(34),
    "Current",
    "Suggested",
    "Samples",
    "-".repeat(34),
    ...result.suggestions.map((suggestion) =>
      `${suggestion.key.padEnd(34)} ${String(suggestion.current).padEnd(7)} ${String(suggestion.suggested).padEnd(9)} ${suggestion.samples}`,
    ),
    "",
    "Suggested config snippet:",
    JSON.stringify({
      thresholds: Object.fromEntries(result.suggestions.map((suggestion) => [suggestion.key, suggestion.suggested])),
    }, null, 2),
  ];
  return `${lines.join("\n")}\n`;
}

function clampPercentile(value: number): number {
  if (!Number.isFinite(value)) return 90;
  return Math.min(99, Math.max(50, Math.round(value)));
}

function percentileValue(values: number[], quantile: number): number {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * quantile) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}
