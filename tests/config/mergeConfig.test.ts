import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { defaultConfig } from "../../src/config/defaults.js";

describe("mergeConfig", () => {
  it("merges plugin thresholds after built-in defaults and before user config", () => {
    const options = mergeConfig(".", { thresholds: { "from-config.max": 10, "shared.max": 20 } }, {
      cwd: process.cwd(),
      pluginThresholds: { "from-plugin.max": 5, "shared.max": 1 },
      thresholds: { "from-cli.max": 99 },
    });

    assert.equal(options.thresholds["from-plugin.max"], 5);
    assert.equal(options.thresholds["from-config.max"], 10);
    assert.equal(options.thresholds["shared.max"], 20);
    assert.equal(options.thresholds["from-cli.max"], 99);
    assert.equal(options.thresholds["large-component.maxLines"], defaultConfig.thresholds["large-component.maxLines"]);
  });

  it("lets CLI thresholds override config and plugin values", () => {
    const options = mergeConfig(".", { thresholds: { "shared.max": 20 } }, {
      cwd: process.cwd(),
      pluginThresholds: { "shared.max": 1 },
      thresholds: { "shared.max": 50 },
    });

    assert.equal(options.thresholds["shared.max"], 50);
  });

  it("merges plugin vocabulary below user config groups", () => {
    const options = mergeConfig(".", { vocabulary: { media: ["movie"], payments: ["invoice"] } }, {
      cwd: process.cwd(),
      pluginVocabulary: { media: ["film", "show"], logging: ["log", "trace"] },
    });

    assert.deepEqual(options.vocabulary?.media, ["movie"]);
    assert.deepEqual(options.vocabulary?.logging, ["log", "trace"]);
    assert.deepEqual(options.vocabulary?.payments, ["invoice"]);
  });

  it("passes through valid ruleSeverities and ruleConfidenceFloors", () => {
    const options = mergeConfig(".", {
      ruleSeverities: { "naming-drift": "info" },
      ruleConfidenceFloors: { "prop-drilling": 0.8 },
    }, { cwd: process.cwd() });

    assert.deepEqual(options.ruleSeverities, { "naming-drift": "info" });
    assert.deepEqual(options.ruleConfidenceFloors, { "prop-drilling": 0.8 });
  });

  it("rejects invalid ruleSeverities values", () => {
    assert.throws(
      () => mergeConfig(".", { ruleSeverities: { "naming-drift": "loud" as never } }, { cwd: process.cwd() }),
      /"ruleSeverities.naming-drift" must be one of info, low, medium, high/,
    );
  });

  it("rejects out-of-range ruleConfidenceFloors values", () => {
    assert.throws(
      () => mergeConfig(".", { ruleConfidenceFloors: { "prop-drilling": 1.5 } }, { cwd: process.cwd() }),
      /"ruleConfidenceFloors.prop-drilling" must be a number between 0 and 1/,
    );
  });
});
