const FIELD_SEPARATOR = "\n";

export interface FingerprintInput {
  ruleId: string;
  file: string;
  message: string;
  evidence?: string[];
}

export function computeIssueFingerprint(input: FingerprintInput): string {
  const parts = [
    input.ruleId,
    input.file,
    normalizeText(input.message),
    normalizeText((input.evidence ?? []).join("\n")),
  ].join(FIELD_SEPARATOR);
  return fnv1a(parts);
}

function normalizeText(value: string): string {
  return value.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `dl_${(hash >>> 0).toString(16)}`;
}
