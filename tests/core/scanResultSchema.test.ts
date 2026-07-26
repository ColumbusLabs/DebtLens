import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildScanResultSchema, SCAN_RESULT_SCHEMA_ID } from "../../src/core/scanResultSchema.js";

describe("ScanResult JSON schema", () => {
  it("matches the committed schema file (no drift)", () => {
    const onDisk = JSON.parse(readFileSync("schema/debtlens.scan-result.schema.json", "utf8"));
    assert.deepEqual(onDisk, buildScanResultSchema());
  });

  it("publishes the v1 ScanResult contract shape", () => {
    const schema = buildScanResultSchema() as {
      $id: string;
      required: string[];
      properties: {
        schemaVersion: { const: number };
        issues: { items: { required: string[]; properties: Record<string, unknown> } };
        suppressions: { items: { required: string[] } };
        suppressionDirectives: { items: { required: string[] } };
        summary: {
          properties: {
            deltaFromBaseline?: { required: string[] };
            correlations?: { items: { required: string[] } };
            duplicateClusters?: { items: { required: string[] } };
            topPayoffTargets?: { maxItems: number; items: { required: string[] } };
            issueSelection?: { required: string[] };
            importGraph?: { required: string[]; properties: { edges: { items: { required: string[] } } } };
            hotspots?: {
              required: string[];
              properties: {
                ranking: { items: { required: string[]; properties: { churn: { required: string[] } } } };
              };
            };
            ownership?: {
              required: string[];
              properties: {
                ownerSummaries: { items: { required: string[]; properties: { topFiles: { items: { required: string[] } } } } };
                unownedHotspots: { items: { required: string[] } };
              };
            };
          };
        };
      };
    };

    assert.equal(schema.$id, SCAN_RESULT_SCHEMA_ID);
    assert.deepEqual(schema.required, ["schemaVersion", "issues", "summary", "options"]);
    assert.equal(schema.properties.schemaVersion.const, 1);
    assert.ok(schema.properties.issues.items.required.includes("fingerprint"));
    assert.ok("payoffScore" in schema.properties.issues.items.properties);
    assert.ok(schema.properties.suppressions.items.required.includes("reason"));
    assert.ok(schema.properties.suppressionDirectives.items.required.includes("recommendedAction"));
    assert.ok(schema.properties.suppressionDirectives.items.required.includes("suppressedIssueCount"));
    assert.ok(schema.properties.summary.properties.deltaFromBaseline?.required.includes("totalDelta"));
    assert.ok(schema.properties.summary.properties.correlations?.items.required.includes("rules"));
    assert.ok(schema.properties.summary.properties.duplicateClusters?.items.required.includes("locations"));
    assert.equal(schema.properties.summary.properties.topPayoffTargets?.maxItems, 10);
    assert.ok(schema.properties.summary.properties.topPayoffTargets?.items.required.includes("payoffScore"));
    assert.ok(schema.properties.summary.properties.issueSelection?.required.includes("totalAvailable"));
    assert.ok(schema.properties.summary.properties.issueSelection?.required.includes("omitted"));
    assert.ok(schema.properties.summary.properties.importGraph?.required.includes("edges"));
    assert.ok(schema.properties.summary.properties.importGraph?.properties.edges.items.required.includes("inCycle"));
    assert.ok(schema.properties.summary.properties.hotspots?.required.includes("ranking"));
    assert.ok(schema.properties.summary.properties.hotspots?.properties.ranking.items.required.includes("churn"));
    assert.ok(schema.properties.summary.properties.hotspots?.properties.ranking.items.properties.churn.required.includes("changedLines"));
    assert.ok(schema.properties.summary.properties.ownership?.required.includes("ownerSummaries"));
    assert.ok(schema.properties.summary.properties.ownership?.required.includes("unownedHotspots"));
    assert.ok(schema.properties.summary.properties.ownership?.properties.ownerSummaries.items.required.includes("topFiles"));
    assert.ok(schema.properties.summary.properties.ownership?.properties.unownedHotspots.items.required.includes("owners"));
  });
});
