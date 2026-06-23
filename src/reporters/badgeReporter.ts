import type { ScanResult, Severity } from "../core/types.js";

export interface BadgeThresholds {
  greenMax: number;
  yellowMax: number;
}

export interface BadgeRenderOptions {
  label?: string;
  thresholds?: BadgeThresholds;
  trend?: "up" | "down" | "flat";
}

const defaultThresholds: BadgeThresholds = {
  greenMax: 20,
  yellowMax: 100,
};

export function renderBadgeSvg(result: ScanResult, options: BadgeRenderOptions = {}): string {
  const label = options.label ?? "debt";
  const total = result.summary.totalIssues;
  const high = result.summary.bySeverity.high;
  const trendArrow = renderTrendArrow(options.trend);
  const color = colorForBadge(high, total, options.thresholds ?? defaultThresholds);
  const message = high > 0 ? `${total} (${high} high)` : String(total);
  const width = estimateWidth(label, message, trendArrow);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(`${label}: ${message}`)}">
  <linearGradient id="debtlens-badge-shade" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="debtlens-badge-clip"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#debtlens-badge-clip)">
    <rect width="${labelWidth(label)}" height="20" fill="#555"/>
    <rect x="${labelWidth(label)}" width="${messageWidth(message, trendArrow)}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#debtlens-badge-shade)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth(label) / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth(label) + messageWidth(message, trendArrow) / 2}" y="14">${escapeXml(message)}${trendArrow ?? ""}</text>
  </g>
</svg>`;
}

export function renderBadgeEndpoint(result: ScanResult, options: BadgeRenderOptions = {}): string {
  const total = result.summary.totalIssues;
  const high = result.summary.bySeverity.high;
  const color = shieldsColor(colorForBadge(high, total, options.thresholds ?? defaultThresholds));
  const payload = {
    schemaVersion: 1,
    label: options.label ?? "debt",
    message: high > 0 ? `${total} (${high} high)` : String(total),
    color,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function colorForBadge(high: number, total: number, thresholds: BadgeThresholds): string {
  if (high > 0) return "#e05d44";
  if (total === 0) return "#4c1";
  return colorForCount(total, thresholds);
}

function colorForCount(count: number, thresholds: BadgeThresholds): string {
  if (count <= thresholds.greenMax) return "#4c1";
  if (count <= thresholds.yellowMax) return "#dfb317";
  return "#e05d44";
}

function shieldsColor(hex: string): string {
  if (hex === "#4c1") return "brightgreen";
  if (hex === "#dfb317") return "yellow";
  return "red";
}

function labelWidth(label: string): number {
  return Math.max(54, label.length * 7 + 14);
}

function messageWidth(message: string, trendArrow?: string): number {
  const extra = trendArrow ? 14 : 0;
  return Math.max(34, message.length * 7 + 14 + extra);
}

function estimateWidth(label: string, message: string, trendArrow?: string): number {
  return labelWidth(label) + messageWidth(message, trendArrow);
}

function renderTrendArrow(trend: BadgeRenderOptions["trend"]): string | undefined {
  if (trend === "up") return " ↑";
  if (trend === "down") return " ↓";
  if (trend === "flat") return " →";
  return undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function parseBadgeThresholds(raw: { greenMax?: number; yellowMax?: number; green?: number; yellow?: number } | undefined): BadgeThresholds | undefined {
  if (!raw) return undefined;
  const greenMax = raw.greenMax ?? raw.green;
  const yellowMax = raw.yellowMax ?? raw.yellow;
  if (greenMax === undefined && yellowMax === undefined) return undefined;
  return {
    greenMax: greenMax ?? defaultThresholds.greenMax,
    yellowMax: yellowMax ?? defaultThresholds.yellowMax,
  };
}

export type { Severity };
