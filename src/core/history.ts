import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { summarizeIssues } from "./issueAggregates.js";
import type { DebtIssue, ScanResult, Severity } from "./types.js";

export interface HistoryEntry {
  timestamp: string;
  gitSha?: string;
  totalIssues: number;
  bySeverity: Record<Severity, number>;
  byRule: Record<string, number>;
  byDirectory: Record<string, number>;
}

export interface HistoryReadOptions {
  since?: string;
  limit?: number;
}

export const DEFAULT_HISTORY_PATH = ".debtlens/history.jsonl";

export function getHistoryPath(cwd: string, explicitPath?: string): string {
  return resolve(cwd, explicitPath ?? DEFAULT_HISTORY_PATH);
}

export function buildHistoryEntry(result: ScanResult, gitSha?: string): HistoryEntry {
  const summary = summarizeIssues(result.issues);
  return {
    timestamp: new Date().toISOString(),
    ...(gitSha ? { gitSha } : {}),
    totalIssues: summary.totalIssues,
    bySeverity: summary.bySeverity,
    byRule: summary.byRule,
    byDirectory: groupIssuesByDirectory(result.issues),
  };
}

export function readHistoryEntries(historyPath: string, options: HistoryReadOptions = {}): HistoryEntry[] {
  if (!existsSync(historyPath)) return [];
  const lines = readFileSync(historyPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = lines.map((line, index) => parseHistoryLine(line, index + 1));
  const filtered = options.since ? filterSince(entries, options.since) : entries;
  const limited = options.limit && options.limit > 0 ? filtered.slice(-options.limit) : filtered;
  return limited;
}

export function appendHistoryEntry(
  historyPath: string,
  entry: HistoryEntry,
  options: { once?: boolean } = {},
): { appended: boolean; path: string } {
  if (options.once && entry.gitSha) {
    const existing = readHistoryEntries(historyPath);
    if (existing.some((candidate) => candidate.gitSha === entry.gitSha)) {
      return { appended: false, path: historyPath };
    }
  }

  mkdirSync(dirname(historyPath), { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  if (!existsSync(historyPath)) {
    writeAtomic(historyPath, line);
    return { appended: true, path: historyPath };
  }

  const tempPath = `${historyPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const current = readFileSync(historyPath, "utf8");
    writeFileSync(tempPath, `${current}${line}`, "utf8");
    renameSync(tempPath, historyPath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup.
    }
    appendFileSync(historyPath, line, "utf8");
    if (error instanceof Error) throw error;
  }
  return { appended: true, path: historyPath };
}

function parseHistoryLine(line: string, lineNumber: number): HistoryEntry {
  try {
    const parsed = JSON.parse(line) as HistoryEntry;
    if (!parsed.timestamp || typeof parsed.totalIssues !== "number") {
      throw new Error("missing required fields");
    }
    return {
      timestamp: parsed.timestamp,
      gitSha: parsed.gitSha,
      totalIssues: parsed.totalIssues,
      bySeverity: parsed.bySeverity ?? { high: 0, medium: 0, low: 0, info: 0 },
      byRule: parsed.byRule ?? {},
      byDirectory: parsed.byDirectory ?? {},
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid history entry on line ${lineNumber}: ${message}`);
  }
}

function filterSince(entries: HistoryEntry[], since: string): HistoryEntry[] {
  const sinceDate = Date.parse(since);
  if (Number.isFinite(sinceDate)) {
    return entries.filter((entry) => Date.parse(entry.timestamp) >= sinceDate);
  }
  const sha = since.trim().toLowerCase();
  const index = entries.findIndex((entry) => entry.gitSha?.toLowerCase().startsWith(sha));
  if (index === -1) return entries;
  return entries.slice(index);
}

function groupIssuesByDirectory(issues: DebtIssue[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const directory = topLevelDirectory(issue.file);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function topLevelDirectory(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.length <= 1) return normalized;
  return parts.slice(0, 2).join("/");
}

function writeAtomic(path: string, contents: string): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, contents, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup.
    }
    throw error;
  }
}
