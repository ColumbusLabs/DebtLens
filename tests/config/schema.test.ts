import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildConfigSchema, SCHEMA_ID } from "../../src/config/schema.js";
import { renderConfigFile } from "../../src/config/template.js";
import { severities } from "../../src/core/severity.js";
import { detectorIds } from "../../src/detectors/index.js";

type SchemaShape = {
  $id: string;
  properties: {
    rules: { items: { enum: string[] } };
    minSeverity: { enum: string[] };
    respectGitignore: { type: string };
  };
};

const schema = buildConfigSchema() as unknown as SchemaShape;

describe("config JSON schema", () => {
  it("matches the committed schema file (no drift)", () => {
    const onDisk = JSON.parse(readFileSync("schema/debtlens.config.schema.json", "utf8"));
    assert.deepEqual(onDisk, buildConfigSchema());
  });

  it("lists every detector id in the rules enum", () => {
    const ruleEnum = schema.properties.rules.items.enum;
    for (const id of detectorIds) {
      assert.ok(ruleEnum.includes(id), `missing rule id in schema: ${id}`);
    }
    assert.equal(ruleEnum.length, detectorIds.length);
  });

  it("uses the canonical severity set", () => {
    assert.deepEqual(schema.properties.minSeverity.enum, [...severities]);
  });

  it("uses the canonical raw GitHub schema URL", () => {
    assert.equal(schema.$id, SCHEMA_ID);
    assert.equal(JSON.parse(renderConfigFile()).$schema, SCHEMA_ID);
  });

  it("resolves the canonical schema URL to JSON", async () => {
    const response = await fetch(SCHEMA_ID);
    assert.equal(response.ok, true);
    const remote = await response.json() as { title?: string };
    assert.equal(remote.title, "DebtLens configuration");
  });

  it("validates the example config's rules and severity", () => {
    const example = JSON.parse(readFileSync("debtlens.config.example.json", "utf8"));
    const ruleEnum = schema.properties.rules.items.enum;
    assert.equal(example.$schema, SCHEMA_ID);
    for (const rule of example.rules) {
      assert.ok(ruleEnum.includes(rule), `example uses unknown rule: ${rule}`);
    }
    assert.ok(schema.properties.minSeverity.enum.includes(example.minSeverity));
    assert.equal(schema.properties.respectGitignore.type, "boolean");
    assert.equal(typeof example.respectGitignore, "boolean");
  });
});
