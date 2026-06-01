import type { Severity } from "./types.js";

export const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export const severities: Severity[] = ["info", "low", "medium", "high"];

export function isSeverity(value: string | undefined): value is Severity {
  return value === "info" || value === "low" || value === "medium" || value === "high";
}

export function parseSeverity(value: string | undefined, fallback: Severity): Severity {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (!isSeverity(normalized)) {
    throw new Error(`Invalid severity "${value}". Expected one of: ${severities.join(", ")}`);
  }
  return normalized;
}

export function meetsMinSeverity(severity: Severity, minSeverity: Severity): boolean {
  return severityRank[severity] >= severityRank[minSeverity];
}

export function compareSeverityDesc(a: Severity, b: Severity): number {
  return severityRank[b] - severityRank[a];
}
