import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeConfig } from "../../src/config/mergeConfig.js";
import { defaultConfig } from "../../src/config/defaults.js";
import type { Detector } from "../../src/core/types.js";

const pluginDetector = {
  id: "policy-no-console",
  name: "Policy no console",
  description: "Flags console use from an organization policy module.",
  defaultSeverity: "low",
  tags: ["policy"],
  detect: () => [],
} satisfies Detector;

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

  it("adds plugin rules to pack-derived rule selection", () => {
    const options = mergeConfig(".", { pack: "core" }, {
      cwd: process.cwd(),
      pluginDetectors: [pluginDetector],
    });

    assert.ok(options.rules?.includes("duplicate-logic"));
    assert.ok(options.rules?.includes("policy-no-console"));
  });

  it("keeps explicit rules exact when plugin detectors are loaded", () => {
    const options = mergeConfig(".", { pack: "core" }, {
      cwd: process.cwd(),
      rules: ["todo-comment"],
      pluginDetectors: [pluginDetector],
    });

    assert.deepEqual(options.rules, ["todo-comment"]);
  });

  it("derives explicit plugin-rule discovery from detector language metadata", () => {
    const pythonPluginDetector = {
      ...pluginDetector,
      id: "policy-python-fixture",
      languages: ["python"],
    } satisfies Detector;

    const options = mergeConfig(".", {}, {
      cwd: process.cwd(),
      rules: ["policy-python-fixture"],
      pluginDetectors: [pythonPluginDetector],
    });

    assert.deepEqual(options.rules, ["policy-python-fixture"]);
    assert.deepEqual(options.include, ["**/*.py"]);
  });

  it("adds plugin language discovery when plugin rules run beside pack defaults", () => {
    const pythonPluginDetector = {
      ...pluginDetector,
      id: "policy-python-fixture",
      languages: ["python"],
    } satisfies Detector;

    const options = mergeConfig(".", { pack: "core" }, {
      cwd: process.cwd(),
      pluginDetectors: [pythonPluginDetector],
    });

    assert.ok(options.rules?.includes("duplicate-logic"));
    assert.ok(options.rules?.includes("policy-python-fixture"));
    assert.deepEqual(options.include, ["**/*.{ts,tsx,js,jsx}", "**/*.py"]);
  });

  it("adds plugin language discovery when plugin rules run beside default built-ins", () => {
    const pythonPluginDetector = {
      ...pluginDetector,
      id: "policy-python-fixture",
      languages: ["python"],
    } satisfies Detector;

    const options = mergeConfig(".", {}, {
      cwd: process.cwd(),
      pluginDetectors: [pythonPluginDetector],
    });

    assert.equal(options.rules, undefined);
    assert.deepEqual(options.include, ["**/*.{ts,tsx,js,jsx}", "**/*.py"]);
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
