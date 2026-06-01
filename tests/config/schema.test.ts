import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildConfigSchema } from "../../src/config/schema.js";
import { severities } from "../../src/core/severity.js";
import { detectorIds } from "../../src/detectors/index.js";

type SchemaShape = {
  properties: {
    rules: { items: { enum: string[] } };
    minSeverity: { enum: string[] };
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

  it("validates the example config's rules and severity", () => {
    const example = JSON.parse(readFileSync("debtlens.config.example.json", "utf8"));
    const ruleEnum = schema.properties.rules.items.enum;
    for (const rule of example.rules) {
      assert.ok(ruleEnum.includes(rule), `example uses unknown rule: ${rule}`);
    }
    assert.ok(schema.properties.minSeverity.enum.includes(example.minSeverity));
  });
});
