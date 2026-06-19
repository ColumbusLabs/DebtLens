import { DEFAULT_BASELINE_FILENAME } from "./baseline.js";
import type { DebtLensConfig, GatePreset, Severity } from "./types.js";

export const gatePresets = ["advisory", "new-code", "strict-new-code", "legacy-baseline"] as const satisfies readonly GatePreset[];
export type { GatePreset } from "./types.js";

interface GatePresetDefinition {
  label: string;
  description: string;
  defaults: {
    baseline?: string;
    diffBase?: string;
    failOn?: Severity;
    failOnConfidence?: number;
    failOnRegression?: boolean;
  };
}

export const gatePresetDefinitions: Record<GatePreset, GatePresetDefinition> = {
  advisory: {
    label: "Advisory",
    description: "Report findings without adding a quality-gate failure condition.",
    defaults: {},
  },
  "new-code": {
    label: "New code",
    description: "Gate high-severity findings introduced since the mainline ref.",
    defaults: { diffBase: "origin/main", failOn: "high" },
  },
  "strict-new-code": {
    label: "Strict new code",
    description: "Gate medium+ findings on new code and fail when compared counts regress.",
    defaults: {
      diffBase: "origin/main",
      failOn: "medium",
      failOnConfidence: 0.8,
      failOnRegression: true,
    },
  },
  "legacy-baseline": {
    label: "Legacy baseline",
    description: "Gate findings outside the committed baseline and fail count regressions.",
    defaults: {
      baseline: DEFAULT_BASELINE_FILENAME,
      failOn: "high",
      failOnRegression: true,
    },
  },
};

export function parseGatePreset(value: string): GatePreset {
  if (gatePresets.includes(value as GatePreset)) return value as GatePreset;
  throw new Error(`Invalid gate preset "${value}". Expected ${gatePresets.join(", ")}.`);
}

export function resolveGatePreset(rawValue: unknown, fileConfig: DebtLensConfig): GatePreset | undefined {
  if (typeof rawValue === "string" && rawValue.length > 0) return parseGatePreset(rawValue);
  if (fileConfig.gatePreset !== undefined) return parseGatePreset(String(fileConfig.gatePreset));
  return undefined;
}

export function applyGatePresetDefaults(
  rawOptions: Record<string, unknown>,
  fileConfig: DebtLensConfig,
): { rawOptions: Record<string, unknown>; gatePreset?: GatePreset } {
  const gatePreset = resolveGatePreset(rawOptions.gate, fileConfig);
  if (!gatePreset) return { rawOptions };
  if (rawOptions.writeBaseline !== undefined) return { rawOptions, gatePreset };

  const next = { ...rawOptions };
  const defaults = gatePresetDefinitions[gatePreset].defaults;
  if (defaults.baseline !== undefined && next.baseline === undefined && next.diffBase === undefined) {
    next.baseline = defaults.baseline;
  }
  if (defaults.diffBase !== undefined && next.diffBase === undefined && next.baseline === undefined) {
    next.diffBase = defaults.diffBase;
  }
  if (defaults.failOn !== undefined && next.failOn === undefined && fileConfig.failOn === undefined) {
    next.failOn = defaults.failOn;
  }
  if (
    defaults.failOnConfidence !== undefined &&
    next.failOnConfidence === undefined &&
    fileConfig.failOnConfidence === undefined
  ) {
    next.failOnConfidence = defaults.failOnConfidence;
  }
  if (defaults.failOnRegression !== undefined && next.failOnRegression === undefined) {
    next.failOnRegression = defaults.failOnRegression;
  }

  return { rawOptions: next, gatePreset };
}

export function formatGatePresetSummary(gatePreset: GatePreset | undefined): string {
  if (!gatePreset) return "(none)";
  const definition = gatePresetDefinitions[gatePreset];
  const defaults = formatGatePresetDefaults(gatePreset);
  return `${gatePreset} - ${definition.description}${defaults ? ` Defaults: ${defaults}.` : ""}`;
}

export function formatGatePresetDefaults(gatePreset: GatePreset): string {
  const defaults = gatePresetDefinitions[gatePreset].defaults;
  const parts = [
    defaults.baseline ? `--baseline ${defaults.baseline}` : undefined,
    defaults.diffBase ? `--diff-base ${defaults.diffBase}` : undefined,
    defaults.failOn ? `--fail-on ${defaults.failOn}` : undefined,
    defaults.failOnConfidence !== undefined ? `--fail-on-confidence ${defaults.failOnConfidence}` : undefined,
    defaults.failOnRegression ? "--fail-on-regression" : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}
