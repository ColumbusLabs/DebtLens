import type { ScanFilterStats } from "../core/types.js";

export function formatFilterStats(stats: ScanFilterStats | undefined): string | undefined {
  if (!stats) return undefined;

  const parts: string[] = [];
  if (stats.suppressedByBaseline) {
    parts.push(`${stats.suppressedByBaseline} baselined`);
  }
  if (stats.filteredByMinSeverity) {
    parts.push(`${stats.filteredByMinSeverity} below min severity`);
  }
  if (stats.suppressedByInline) {
    parts.push(`${stats.suppressedByInline} inline suppressed`);
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}
