import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildConfigSchema, SCHEMA_ID } from "../../src/config/schema.js";

describe("SchemaStore registration packet", () => {
  it("points SchemaStore at the canonical DebtLens config schema URL", () => {
    const entry = JSON.parse(readFileSync("schema/schemastore-catalog-entry.json", "utf8")) as {
      name: string;
      description: string;
      fileMatch: string[];
      url: string;
    };

    assert.equal(entry.name, "DebtLens");
    assert.equal(entry.url, SCHEMA_ID);
    assert.deepEqual(entry.fileMatch, ["debtlens.config.json", ".debtlensrc.json"]);
    assert.match(entry.description, /DebtLens/);
  });

  it("keeps the canonical schema valid for SchemaStore consumers", () => {
    const schema = buildConfigSchema();

    assert.equal(schema.$id, SCHEMA_ID);
    assert.equal(schema.title, "DebtLens configuration");
    assert.equal(schema.type, "object");
  });
});
