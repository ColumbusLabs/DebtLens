export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsTrackerLink(line: string): boolean {
  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(line)
    || /\b(?:issue|ticket|bug|gh|github)\s*#?\d+\b/i.test(line)
    || /(?:^|[\s([#])#\d+\b/.test(line)
    || /https?:\/\/\S+\b(?:issues|browse|tickets?)\/\d+\b/i.test(line);
}
