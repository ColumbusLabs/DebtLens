import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCalibrateSuggestions, renderCalibrateReport } from "../../src/core/calibrate.js";
import type { ScanOptions, ScanResult } from "../../src/core/types.js";

describe("calibrate", () => {
  it("renders suggested thresholds from observed evidence", () => {
    const result: ScanResult = {
      schemaVersion: 1,
      issues: [{
        id: "1",
        ruleId: "large-component",
        ruleName: "Large component",
        severity: "medium",
        confidence: 0.8,
        message: "big",
        file: "src/Dashboard.tsx",
        tags: [],
        evidence: ["Lines: 300 / 250", "Branch points: 20 / 16"],
      }],
      summary: {
        totalIssues: 1,
        bySeverity: { high: 0, medium: 1, low: 0, info: 0 },
        byRule: { "large-component": 1 },
        filesScanned: 1,
        rulesRun: 1,
        elapsedMs: 1,
      },
      options: { target: ".", include: [], exclude: [], minSeverity: "low" },
    };
    const options: ScanOptions = {
      cwd: "/",
      target: ".",
      include: [],
      exclude: [],
      minSeverity: "low",
      thresholds: {
        "large-component.maxLines": 250,
        "large-component.maxBranches": 16,
      },
    };
    const calibrate = buildCalibrateSuggestions(result, options, { percentile: 90 });
    const report = renderCalibrateReport(calibrate);
    assert.match(report, /large-component\.maxLines/);
  });
});
