import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildConfigSchema, SCHEMA_ID } from "../../src/config/schema.js";
import { configTemplate, renderConfigFile } from "../../src/config/template.js";
import { getRulePack } from "../../src/config/packs.js";
import { gatePresets } from "../../src/core/gatePresets.js";
import { severities } from "../../src/core/severity.js";
import { detectorIds } from "../../src/detectors/index.js";

type SchemaShape = {
  $id: string;
  properties: {
    rules: { items: { anyOf: [{ enum: string[] }, { type: string }] } };
    minSeverity: { enum: string[] };
    respectGitignore: { type: string };
    gatePreset: { enum: string[] };
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

  it("includes pack threshold defaults in threshold completions", () => {
    const built = buildConfigSchema() as {
      properties: { thresholds: { properties: Record<string, { type: string }> } };
    };

    for (const key of Object.keys(getRulePack("swiftui").thresholds ?? {})) {
      assert.equal(built.properties.thresholds.properties[key]?.type, "number", `missing threshold key: ${key}`);
    }
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
    assert.deepEqual(example.rules, configTemplate.rules);
    assert.ok(schema.properties.minSeverity.enum.includes(example.minSeverity));
    assert.equal(schema.properties.respectGitignore.type, "boolean");
    assert.equal(typeof example.respectGitignore, "boolean");
  });

  it("validates the repo self-scan config against known schema fields", () => {
    const selfConfig = JSON.parse(readFileSync("debtlens.self.config.json", "utf8")) as {
      $schema: string;
      include: string[];
      exclude: string[];
      respectGitignore: boolean;
      duplicatedLiteral?: { ignoreStrings?: string[] };
    };

    assert.equal(selfConfig.$schema, SCHEMA_ID);
    assert.ok(selfConfig.include.some((pattern) => pattern.startsWith("src/")));
    assert.ok(selfConfig.exclude.includes("examples/**"));
    assert.equal(selfConfig.respectGitignore, true);
    assert.ok(selfConfig.duplicatedLiteral?.ignoreStrings?.includes("terminal"));
  });

  it("includes failOn with the canonical severity set", () => {
    const built = buildConfigSchema() as { properties: { failOn?: { enum: string[] } } };
    assert.deepEqual(built.properties.failOn?.enum, [...severities]);
  });

  it("includes gatePreset with the canonical preset set", () => {
    assert.deepEqual(schema.properties.gatePreset.enum, [...gatePresets]);
  });

  it("includes todoComment config shape", () => {
    const built = buildConfigSchema() as {
      properties: {
        todoComment?: { type: string };
        duplicatedLiteral?: {
          type: string;
          properties: { ignoreStrings?: { type: string; items: { type: string } } };
        };
        pack?: { anyOf: Array<{ enum?: string[]; pattern?: string }> };
      };
    };
    assert.equal(built.properties.todoComment?.type, "object");
    assert.equal(built.properties.duplicatedLiteral?.type, "object");
    assert.equal(built.properties.duplicatedLiteral?.properties.ignoreStrings?.type, "array");
    assert.deepEqual(built.properties.pack?.anyOf[0]?.enum, [
      "core",
      "react",
      "react-native",
      "next",
      "expo",
      "node",
      "python",
      "python-web",
      "vue",
      "svelte",
      "kotlin",
      "swift",
      "swiftui",
      "ruby",
      "rails",
      "compose",
      "ai-assisted-maintainer",
      "oss-maintainer",
      "ai-workflow-drift",
      "feature-flags",
    ]);
    assert.match(built.properties.pack?.anyOf[1]?.pattern ?? "", /compose/);
    assert.match(built.properties.pack?.anyOf[1]?.pattern ?? "", /svelte/);
  });
});
