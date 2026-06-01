import type { DebtIssue, Detector, IssueLocation, Severity } from "../core/types.js";

export interface CreateIssueInput {
  detector: Detector;
  severity?: Severity;
  confidence?: number;
  message: string;
  file: string;
  location?: IssueLocation;
  evidence?: string[];
  suggestion?: string;
  tags?: string[];
}

export function createIssue(input: CreateIssueInput): DebtIssue {
  const stable = `${input.detector.id}:${input.file}:${input.location?.startLine ?? 0}:${input.message}`;

  return {
    id: hashString(stable),
    ruleId: input.detector.id,
    ruleName: input.detector.name,
    severity: input.severity ?? input.detector.defaultSeverity,
    confidence: clamp(input.confidence ?? 0.75, 0, 1),
    message: input.message,
    file: input.file,
    location: input.location,
    evidence: input.evidence,
    suggestion: input.suggestion,
    tags: Array.from(new Set([...(input.detector.tags ?? []), ...(input.tags ?? [])])),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `dl_${(hash >>> 0).toString(16)}`;
}
