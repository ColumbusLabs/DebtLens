export function escapeMarkdownTableCell(value: string): string {
  return normalizeMarkdownText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|");
}

export function normalizeMarkdownText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
