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
    rules: { items: { anyOf: [{ enum: string[] }, { type: string }] } };
    minSeverity: { enum: string[] };
    respectGitignore: { type: string };
  };
};

const schema = buildConfigSchema() as unknown as SchemaShape;
const ruleEnum = schema.properties.rules.items.anyOf[0].enum;

describe("config JSON schema", () => {
  it("matches the committed schema file (no drift)", () => {
    const onDisk = JSON.parse(readFileSync("schema/debtlens.config.schema.json", "utf8"));
    assert.deepEqual(onDisk, buildConfigSchema());
  });

  it("lists every detector id in the rules enum", () => {
    for (const id of detectorIds) {
      assert.ok(ruleEnum.includes(id), `missing rule id in schema: ${id}`);
    }
    assert.equal(ruleEnum.length, detectorIds.length);
  });

  it("accepts plugin rule ids as plain strings in rules", () => {
    assert.equal(schema.properties.rules.items.anyOf[1].type, "string");
  });

  it("includes plugin configuration fields", () => {
    const built = buildConfigSchema() as {
      properties: { pluginApiVersion?: { type: string; minimum: number }; plugins?: { type: string } };
    };
    assert.equal(built.properties.pluginApiVersion?.type, "integer");
    assert.equal(built.properties.pluginApiVersion?.minimum, 1);
    assert.equal(built.properties.plugins?.type, "array");
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
    assert.equal(example.$schema, SCHEMA_ID);
    for (const rule of example.rules) {
      assert.ok(ruleEnum.includes(rule), `example uses unknown rule: ${rule}`);
    }
    assert.ok(schema.properties.minSeverity.enum.includes(example.minSeverity));
    assert.equal(schema.properties.respectGitignore.type, "boolean");
    assert.equal(typeof example.respectGitignore, "boolean");
  });

  it("includes failOn with the canonical severity set", () => {
    const built = buildConfigSchema() as { properties: { failOn?: { enum: string[] } } };
    assert.deepEqual(built.properties.failOn?.enum, [...severities]);
  });

  it("includes todoComment config shape", () => {
    const built = buildConfigSchema() as { properties: { todoComment?: { type: string }; pack?: { enum: string[] } } };
    assert.equal(built.properties.todoComment?.type, "object");
    assert.deepEqual(built.properties.pack?.enum, [
      "core",
      "react",
      "react-native",
      "next",
      "expo",
      "ai-assisted-maintainer",
      "oss-maintainer",
    ]);
  });
});
