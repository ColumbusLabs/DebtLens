import type { DebtIssue, Detector, IssueLocation, Severity } from "../core/types.js";
import { computeIssueFingerprint } from "./fingerprint.js";

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
  const fingerprint = computeIssueFingerprint({
    ruleId: input.detector.id,
    file: input.file,
    message: input.message,
    evidence: input.evidence,
  });

  return {
    id: fingerprint,
    fingerprint,
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
