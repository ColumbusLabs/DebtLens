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
        issues: { items: { required: string[] } };
        suppressions: { items: { required: string[] } };
        summary: {
          properties: {
            deltaFromBaseline?: { required: string[] };
            correlations?: { items: { required: string[] } };
            duplicateClusters?: { items: { required: string[] } };
          };
        };
      };
    };

    assert.equal(schema.$id, SCAN_RESULT_SCHEMA_ID);
    assert.deepEqual(schema.required, ["schemaVersion", "issues", "summary", "options"]);
    assert.equal(schema.properties.schemaVersion.const, 1);
    assert.ok(schema.properties.issues.items.required.includes("fingerprint"));
    assert.ok(schema.properties.suppressions.items.required.includes("reason"));
    assert.ok(schema.properties.summary.properties.deltaFromBaseline?.required.includes("totalDelta"));
    assert.ok(schema.properties.summary.properties.correlations?.items.required.includes("rules"));
    assert.ok(schema.properties.summary.properties.duplicateClusters?.items.required.includes("locations"));
  });
});
