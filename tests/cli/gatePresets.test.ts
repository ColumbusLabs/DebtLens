import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_BASELINE_FILENAME } from "../../src/core/baseline.js";
import { applyGatePresetDefaults, parseGatePreset } from "../../src/core/gatePresets.js";

describe("gate presets", () => {
  it("expands new-code defaults", () => {
    const result = applyGatePresetDefaults({ gate: "new-code" }, {});

    assert.equal(result.gatePreset, "new-code");
    assert.deepEqual(result.rawOptions, {
      gate: "new-code",
      diffBase: "origin/main",
      failOn: "high",
    });
  });

  it("expands strict-new-code defaults", () => {
    const result = applyGatePresetDefaults({ gate: "strict-new-code" }, {});

    assert.equal(result.gatePreset, "strict-new-code");
    assert.deepEqual(result.rawOptions, {
      gate: "strict-new-code",
      diffBase: "origin/main",
      failOn: "medium",
      failOnConfidence: 0.8,
      failOnRegression: true,
    });
  });

  it("expands legacy-baseline defaults", () => {
    const result = applyGatePresetDefaults({ gate: "legacy-baseline" }, {});

    assert.equal(result.gatePreset, "legacy-baseline");
    assert.deepEqual(result.rawOptions, {
      gate: "legacy-baseline",
      baseline: DEFAULT_BASELINE_FILENAME,
      failOn: "high",
      failOnRegression: true,
    });
  });

  it("lets explicit CLI and config policies override preset defaults", () => {
    const result = applyGatePresetDefaults({
      gate: "strict-new-code",
      baseline: "custom-baseline.json",
      failOn: "high",
    }, {
      failOnConfidence: 0.95,
    });

    assert.deepEqual(result.rawOptions, {
      gate: "strict-new-code",
      baseline: "custom-baseline.json",
      failOn: "high",
      failOnRegression: true,
    });
  });

  it("does not apply gate defaults while writing a baseline", () => {
    const result = applyGatePresetDefaults({ writeBaseline: true }, {
      gatePreset: "legacy-baseline",
    });

    assert.equal(result.gatePreset, "legacy-baseline");
    assert.deepEqual(result.rawOptions, { writeBaseline: true });
  });

  it("rejects invalid config-sourced presets with a clear message", () => {
    assert.throws(
      () => applyGatePresetDefaults({}, { gatePreset: "block-everything" as never }),
      /Invalid gate preset "block-everything"/,
    );
  });

  it("rejects unknown presets", () => {
    assert.throws(() => parseGatePreset("block-everything"), /Invalid gate preset "block-everything"/);
  });
});
