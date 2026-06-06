import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { scan } from "../../src/core/scan.js";

describe("scan integration", () => {
  it("runs the full pipeline against examples/react", async () => {
    const cwd = process.cwd();
    const result = await scan({
      cwd,
      target: resolve("examples/react"),
      include: defaultConfig.include,
      exclude: [],
      minSeverity: "medium",
      rules: ["duplicate-logic", "prop-drilling"],
      thresholds: {},
      maxFiles: defaultConfig.maxFiles,
    });

    assert.equal(result.summary.filesScanned, 3);
    assert.equal(result.summary.rulesRun, 2);
    assert.equal(result.summary.totalIssues, 2);
    assert.equal(result.summary.bySeverity.high, 2);
    assert.deepEqual(result.summary.byRule, {
      "prop-drilling": 1,
      "duplicate-logic": 1,
    });

    assert.deepEqual(result.issues.map((issue) => issue.ruleId), ["prop-drilling", "duplicate-logic"]);
    assert.equal(result.issues[0]?.severity, "high");
    assert.equal(result.issues[0]?.file, "src/Dashboard.tsx");
    assert.equal(result.issues[1]?.severity, "high");
    assert.equal(result.issues[1]?.file, "src/duplicateOne.ts");
  });
});
