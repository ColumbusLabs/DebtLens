import type { ImportGraph } from "../core/importGraph.js";
import type { DebtIssue } from "../core/types.js";

export function renderImportGraphSvg(graph: ImportGraph, width = 640, height = 360): string {
  if (graph.nodes.length === 0) return "";
  const positions = layoutNodes(graph.nodes, width, height);
  const edges = graph.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const stroke = edge.inCycle ? "#e05d44" : "#8c959f";
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="${edge.inCycle ? 2.5 : 1.2}" />`;
  }).join("\n");
  const nodes = graph.nodes.map((node) => {
    const point = positions.get(node);
    if (!point) return "";
    const label = escapeXml(truncate(node));
    return `<g><circle cx="${point.x}" cy="${point.y}" r="16" fill="#eef2f5" stroke="#2f6feb" /><text x="${point.x}" y="${point.y + 28}" text-anchor="middle" font-size="10">${label}</text></g>`;
  }).join("\n");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Import graph">${edges}${nodes}</svg>`;
}

export function renderDebtTreemapSvg(issues: DebtIssue[], width = 640, height = 240): string {
  const byDirectory = aggregateByDirectory(issues);
  const entries = [...byDirectory.entries()].sort((left, right) => right[1].total - left[1].total).slice(0, 12);
  if (entries.length === 0) return "";
  let remainingTotal = Math.max(entries.reduce((total, [, value]) => total + value.total, 0), 1);
  let remainingWidth = width;
  let x = 0;
  const rects = entries.map(([directory, value], index) => {
    const isLast = index === entries.length - 1;
    const proportional = Math.round((value.total / remainingTotal) * remainingWidth);
    const w = isLast ? remainingWidth : Math.max(24, Math.min(remainingWidth, proportional));
    const escapedDirectory = escapeXml(directory);
    const escapedLabel = escapeXml(truncate(directory, 18));
    const rect = `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${heatColor(value.high, value.total)}" stroke="#fff"><title>${escapedDirectory}: ${value.total} issues</title></rect><text x="${x + 8}" y="20" font-size="11">${escapedLabel} (${value.total})</text>`;
    x += w;
    remainingWidth = Math.max(0, remainingWidth - w);
    remainingTotal = Math.max(1, remainingTotal - value.total);
    return rect;
  }).join("\n");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Debt treemap">${rects}</svg>`;
}

function layoutNodes(nodes: string[], width: number, height: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const radius = Math.min(width, height) / 2 - 30;
  const centerX = width / 2;
  const centerY = height / 2;
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    positions.set(node, {
      x: Math.round(centerX + Math.cos(angle) * radius),
      y: Math.round(centerY + Math.sin(angle) * radius),
    });
  });
  return positions;
}

function aggregateByDirectory(issues: DebtIssue[]): Map<string, { total: number; high: number }> {
  const counts = new Map<string, { total: number; high: number }>();
  for (const issue of issues) {
    const directory = issue.file.includes("/") ? issue.file.split("/").slice(0, 2).join("/") : issue.file;
    const current = counts.get(directory) ?? { total: 0, high: 0 };
    current.total += 1;
    if (issue.severity === "high") current.high += 1;
    counts.set(directory, current);
  }
  return counts;
}

function heatColor(high: number, total: number): string {
  if (high > 0) return "#f9c6bd";
  if (total >= 8) return "#f6e6b4";
  return "#d9f0d1";
}

function truncate(value: string, max = 24): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
