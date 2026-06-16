import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DebtIssue, ScanResult, Severity } from "../../src/core/types.js";
import { allDetectors } from "../../src/detectors/index.js";
import { renderSarif } from "../../src/reporters/sarifReporter.js";
import { packageVersion } from "../../src/utils/packageInfo.js";

function makeResult(issues: DebtIssue[]): ScanResult {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;
  return {
    schemaVersion: 1,
    issues,
    summary: {
      totalIssues: issues.length,
      bySeverity,
      byRule: {},
      filesScanned: 1,
      rulesRun: 8,
      elapsedMs: 12,
    },
    options: { target: ".", include: [], exclude: [], minSeverity: "info", rules: undefined },
  };
}

const highIssue: DebtIssue = {
  id: "dl_1",
  fingerprint: "dl_1",
  ruleId: "prop-drilling",
  ruleName: "Prop drilling",
  severity: "high",
  confidence: 0.73,
  message: "Parent forwards 5 props across 1 child component.",
  file: "src/Parent.tsx",
  location: { startLine: 13, endLine: 20 },
  evidence: ["Child: a, b, c, d, e"],
  suggestion: "Colocate the data owner.",
  tags: ["react"],
};

const infoIssue: DebtIssue = {
  id: "dl_2",
  fingerprint: "dl_2",
  ruleId: "naming-drift",
  ruleName: "Naming drift",
  severity: "info",
  confidence: 0.62,
  message: "This file uses 4 competing terms.",
  file: "src/release.ts",
  location: { startLine: 1 },
  tags: ["naming"],
};

describe("sarif reporter", () => {
  it("emits valid SARIF 2.1.0 envelope with the full rule catalog", () => {
    const sarif = JSON.parse(renderSarif(makeResult([highIssue])));
    assert.equal(sarif.version, "2.1.0");
    assert.ok(sarif.$schema.includes("sarif-2.1.0"));
    const driver = sarif.runs[0].tool.driver;
    assert.equal(driver.name, "DebtLens");
    assert.equal(driver.version, packageVersion);
    // All 8 detectors should be present in the rule catalog.
    assert.equal(driver.rules.length, 8);
    assert.ok(driver.rules.some((r: { id: string }) => r.id === "prop-drilling"));
    for (const detector of allDetectors) {
      const rule = driver.rules.find((r: { id: string }) => r.id === detector.id);
      assert.equal(
        rule?.helpUri,
        `https://github.com/ColumbusLabs/DebtLens/blob/main/docs/rules.md#${detector.id}`,
      );
    }
  });

  it("maps severities to SARIF levels and locations correctly", () => {
    const sarif = JSON.parse(renderSarif(makeResult([highIssue, infoIssue])));
    const results = sarif.runs[0].results;
    assert.equal(results.length, 2);

    const high = results.find((r: { ruleId: string }) => r.ruleId === "prop-drilling");
    assert.equal(high.level, "error");
    assert.equal(high.message.text, "Parent forwards 5 props across 1 child component.");
    const region = high.locations[0].physicalLocation.region;
    assert.equal(high.locations[0].physicalLocation.artifactLocation.uri, "src/Parent.tsx");
    assert.equal(region.startLine, 13);
    assert.equal(region.endLine, 20);
    assert.equal(high.properties.suggestion, "Colocate the data owner.");
    assert.deepEqual(high.properties.evidence, ["Child: a, b, c, d, e"]);
    assert.equal(high.properties.fingerprint, "dl_1");

    const info = results.find((r: { ruleId: string }) => r.ruleId === "naming-drift");
    assert.equal(info.level, "note");
    assert.equal(info.locations[0].physicalLocation.region.startLine, 1);
  });

  it("emits an empty results array when there are no issues", () => {
    const sarif = JSON.parse(renderSarif(makeResult([])));
    assert.deepEqual(sarif.runs[0].results, []);
    assert.equal(sarif.runs[0].tool.driver.rules.length, 8);
  });

  it("emits only referenced rules in compact mode", () => {
    const sarif = JSON.parse(renderSarif(makeResult([highIssue]), { compact: true }));

    assert.deepEqual(sarif.runs[0].tool.driver.rules.map((rule: { id: string }) => rule.id), ["prop-drilling"]);
    assert.equal(sarif.runs[0].results[0].ruleIndex, 0);
  });

  it("maps inline suppression audits to SARIF suppressions", () => {
    const sarif = JSON.parse(renderSarif({
      ...makeResult([]),
      suppressions: [{
        ruleId: "prop-drilling",
        file: "src/Parent.tsx",
        kind: "next-line",
        reason: "tracked in PROJ-1",
        directiveLine: 12,
        targetLine: 13,
        issue: highIssue,
      }],
    }));

    const [suppressed] = sarif.runs[0].results;
    assert.equal(suppressed.ruleId, "prop-drilling");
    assert.equal(suppressed.suppressions[0].kind, "inSource");
    assert.equal(suppressed.suppressions[0].status, "accepted");
    assert.equal(suppressed.suppressions[0].justification, "tracked in PROJ-1");
    assert.equal(suppressed.suppressions[0].location.physicalLocation.artifactLocation.uri, "src/Parent.tsx");
    assert.equal(suppressed.suppressions[0].location.physicalLocation.region.startLine, 12);
    assert.equal(suppressed.properties.suppressedBy, "next-line");
    assert.equal(suppressed.properties.suppressionDirectiveLine, 12);
  });
});
