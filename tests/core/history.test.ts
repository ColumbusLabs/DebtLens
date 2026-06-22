import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendHistoryEntry, buildHistoryEntry, readHistoryEntries } from "../../src/core/history.js";
import type { ScanResult } from "../../src/core/types.js";
import { renderHistoryReport } from "../../src/reporters/historyReporter.js";

const sampleResult: ScanResult = {
  schemaVersion: 1,
  issues: [
    { id: "1", ruleId: "todo-comment", ruleName: "Todo", severity: "low", confidence: 1, message: "todo", file: "src/a.ts", tags: [] },
  ],
  summary: {
    totalIssues: 1,
    bySeverity: { high: 0, medium: 0, low: 1, info: 0 },
    byRule: { "todo-comment": 1 },
    filesScanned: 1,
    rulesRun: 1,
    elapsedMs: 1,
  },
  options: { target: ".", include: [], exclude: [], minSeverity: "low" },
};

describe("history ledger", () => {
  it("records and reads entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-history-"));
    const path = join(dir, "history.jsonl");
    try {
      const entry = buildHistoryEntry(sampleResult, "abc123");
      appendHistoryEntry(path, entry);
      const entries = readHistoryEntries(path);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.gitSha, "abc123");
      assert.equal(entries[0]?.byDirectory["src/a.ts"], 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips duplicate SHA when --once semantics are used", () => {
    const dir = mkdtempSync(join(tmpdir(), "debtlens-history-once-"));
    const path = join(dir, "history.jsonl");
    try {
      const entry = buildHistoryEntry(sampleResult, "abc123");
      appendHistoryEntry(path, entry);
      const second = appendHistoryEntry(path, entry, { once: true });
      assert.equal(second.appended, false);
      assert.equal(readHistoryEntries(path).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders terminal and html history reports", () => {
    const entries = [
      { timestamp: "2026-06-01T00:00:00.000Z", totalIssues: 10, bySeverity: { high: 1, medium: 2, low: 5, info: 2 }, byRule: {}, byDirectory: {} },
      { timestamp: "2026-06-02T00:00:00.000Z", totalIssues: 8, bySeverity: { high: 0, medium: 2, low: 4, info: 2 }, byRule: {}, byDirectory: {} },
    ];
    assert.match(renderHistoryReport(entries, "terminal"), /DebtLens history/);
    assert.match(renderHistoryReport(entries, "html"), /<!doctype html>/);
  });
});
