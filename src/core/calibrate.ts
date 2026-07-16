import {
  calibrationDiagnosticsForRules,
  calibrationMetrics,
  collectThresholdObservations,
  type CalibrationDiagnostic,
  type ThresholdSuggestion,
} from "../cli/adoptionThresholds.js";
import type { ScanOptions, ScanResult } from "../core/types.js";

export interface CalibrateOptions {
  percentile: number;
}

export interface CalibrateResult {
  suggestions: ThresholdSuggestion[];
  percentile: number;
  diagnostics: CalibrationDiagnostic[];
}

export function buildCalibrateSuggestions(
  result: ScanResult,
  options: ScanOptions,
  calibrateOptions: CalibrateOptions,
): CalibrateResult {
  const percentile = clampPercentile(calibrateOptions.percentile);
  const observations = collectThresholdObservations(result);
  const suggestions = [...observations.entries()]
    .map(([key, observedValues]) => {
      const current = options.thresholds[key] ?? 0;
      const observed = percentileValue(observedValues, percentile / 100);
      return {
        key,
        current,
        suggested: Math.max(1, Math.ceil(observed * 1.05)),
        observedP90: observed,
        samples: observedValues.length,
        observedValues: [...observedValues],
      };
    })
    .filter((suggestion) => suggestion.current > 0)
    .sort((left, right) => left.key.localeCompare(right.key));
  const selected = options.rules ? new Set(options.rules) : undefined;
  const unavailable = calibrationMetrics
    .filter((entry) => (!selected || entry.ruleIds.some((ruleId) => selected.has(ruleId))) && !observations.has(entry.key))
    .map((entry) => ({
      key: entry.key,
      ruleIds: entry.ruleIds,
      reason: "no raw metric observations were emitted for the selected target",
    }));
  return {
    suggestions,
    percentile,
    diagnostics: [...calibrationDiagnosticsForRules(options.rules), ...unavailable]
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

export function renderCalibrateReport(result: CalibrateResult): string {
  const lines = [
    `DebtLens calibrate (p${result.percentile})`,
    "",
  ];
  if (result.suggestions.length > 0) {
    lines.push(
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
      JSON.stringify({ thresholds: Object.fromEntries(result.suggestions.map((suggestion) => [suggestion.key, suggestion.suggested])) }, null, 2),
    );
  } else {
    lines.push(`No numeric threshold suggestions at the p${result.percentile} percentile.`);
  }
  if (result.diagnostics.length > 0) {
    lines.push("", "Not calibrated:", ...result.diagnostics.map((entry) => `- ${entry.key}: ${entry.reason}`));
  }
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
