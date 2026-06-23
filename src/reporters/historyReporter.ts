import type { HistoryEntry } from "../core/history.js";
import type { Severity } from "../core/types.js";

export type HistoryFormat = "terminal" | "markdown" | "html" | "json";

export function renderHistoryReport(entries: HistoryEntry[], format: HistoryFormat): string {
  if (format === "json") return `${JSON.stringify({ entries }, null, 2)}\n`;
  if (format === "markdown") return renderMarkdown(entries);
  if (format === "html") return renderHtml(entries);
  return renderTerminal(entries);
}

function renderTerminal(entries: HistoryEntry[]): string {
  if (entries.length === 0) return "No history entries recorded yet.\n";
  const lines = [
    "DebtLens history",
    "",
    `${"Timestamp".padEnd(26)}  ${"Total".padEnd(5)}  ${"Trend".padEnd(5)}  ${"High".padEnd(4)}  Sparkline`,
    `${"-".repeat(26)}  ${"-".repeat(5)}  ${"-".repeat(5)}  ${"-".repeat(4)}  ---------`,
  ];
  for (const entry of entries) {
    lines.push(
      `${entry.timestamp.slice(0, 19).replace("T", " ")}  ${String(entry.totalIssues).padEnd(5)}  ${trendArrow(entry, entries).padEnd(5)}  ${String(entry.bySeverity.high).padEnd(4)}  ${sparkline(entry.totalIssues, entries)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(entries: HistoryEntry[]): string {
  if (entries.length === 0) return "# DebtLens history\n\nNo entries recorded yet.\n";
  const lines = ["# DebtLens history", "", "| Timestamp | Total | High | Trend |", "| --- | ---: | ---: | --- |"];
  for (const entry of entries) {
    lines.push(`| ${entry.timestamp} | ${entry.totalIssues} | ${entry.bySeverity.high} | ${trendArrow(entry, entries)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function renderHtml(entries: HistoryEntry[]): string {
  const rows = entries.map((entry) => `<tr><td>${escapeHtml(entry.timestamp)}</td><td>${entry.totalIssues}</td><td>${entry.bySeverity.high}</td><td>${escapeHtml(trendArrow(entry, entries))}</td><td><svg width="80" height="16">${sparklineSvg(entry.totalIssues, entries)}</svg></td></tr>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>DebtLens History</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:32px;color:#172026}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8dee4;padding:8px 10px;text-align:left}</style>
</head><body><h1>DebtLens history</h1><table><thead><tr><th>Timestamp</th><th>Total</th><th>High</th><th>Trend</th><th>Sparkline</th></tr></thead><tbody>
${rows}
</tbody></table></body></html>`;
}

function trendArrow(entry: HistoryEntry, entries: HistoryEntry[]): string {
  const index = entries.indexOf(entry);
  if (index <= 0) return "→";
  const previous = entries[index - 1];
  if (!previous) return "→";
  if (entry.totalIssues > previous.totalIssues) return "↑";
  if (entry.totalIssues < previous.totalIssues) return "↓";
  return "→";
}

function sparkline(value: number, entries: HistoryEntry[]): string {
  const values = entries.map((entry) => entry.totalIssues);
  const max = Math.max(...values, 1);
  const height = 4;
  const normalized = Math.max(1, Math.round((value / max) * height));
  return "▁▂▃▄▅▆▇█"[normalized - 1] ?? "▁";
}

function sparklineSvg(value: number, entries: HistoryEntry[]): string {
  const values = entries.map((entry) => entry.totalIssues);
  const max = Math.max(...values, 1);
  const points = values.map((sample, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 76 + 2;
    const y = 14 - (sample / max) * 12;
    return `${x},${y}`;
  }).join(" ");
  const marker = values.indexOf(value);
  const cx = (marker / Math.max(values.length - 1, 1)) * 76 + 2;
  const cy = 14 - (value / max) * 12;
  return `<polyline fill="none" stroke="#2f6feb" stroke-width="1.5" points="${points}" /><circle cx="${cx}" cy="${cy}" r="2" fill="#e05d44" />`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
