import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import fg from "fast-glob";
import { calibrationDiagnostics, calibrationMetrics } from "../../src/cli/adoptionThresholds.js";

describe("calibration metadata", () => {
  it("classifies every literal threshold used by a built-in detector", () => {
    const used = new Set<string>();
    for (const file of fg.sync("src/detectors/**/*.ts")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/getThreshold\("([^"]+)"/g)) {
        if (match[1]) used.add(match[1]);
      }
    }
    const classified = new Set([
      ...calibrationMetrics.map((entry) => entry.key),
      ...calibrationDiagnostics.map((entry) => entry.key),
    ]);
    assert.deepEqual([...used].filter((key) => !classified.has(key)).sort(), []);
  });

  it("does not claim the same threshold is both calibrated and non-calibratable", () => {
    const supported = new Set(calibrationMetrics.map((entry) => entry.key));
    assert.deepEqual(calibrationDiagnostics.filter((entry) => supported.has(entry.key)).map((entry) => entry.key), []);
  });
});
