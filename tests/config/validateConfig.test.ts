import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfigShape } from "../../src/config/validateConfig.js";

describe("validateConfigShape", () => {
  it("accepts comma-separated built-in packs in config", () => {
    const result = validateConfigShape({ pack: "vue,svelte,kotlin,compose" });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects unknown pack ids inside comma-separated config packs", () => {
    const result = validateConfigShape({ pack: "kotlin,unknown" });

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /pack must be one or more of/);
  });

  it("accepts known gate presets and rejects unknown gate presets", () => {
    const valid = validateConfigShape({ gatePreset: "strict-new-code" });
    const invalid = validateConfigShape({ gatePreset: "block-everything" });

    assert.equal(valid.valid, true);
    assert.deepEqual(valid.errors, []);
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors.join("\n"), /gatePreset must be one of advisory, new-code, strict-new-code, legacy-baseline/);
  });

  it("accepts duplicated-literal ignore config", () => {
    const result = validateConfigShape({
      duplicatedLiteral: {
        ignoreStrings: ["use client", "use server"],
      },
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects invalid duplicated-literal ignore config", () => {
    const result = validateConfigShape({
      duplicatedLiteral: {
        ignoreStrings: ["use client", 123],
        unknown: true,
      },
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /duplicatedLiteral\.ignoreStrings must be an array of strings/);
    assert.match(result.errors.join("\n"), /duplicatedLiteral\.unknown is not allowed/);
  });

  it("accepts budgets, badge, and payoff priority config", () => {
    const result = validateConfigShape({
      budgets: {
        "src/**/*.ts": { maxIssues: 10, maxHigh: 0, maxMedium: 5 },
      },
      badge: { greenMax: 5, yellowMax: 25 },
      priority: {
        churn: 1.5,
        age: 0.5,
        severity: { high: 8, medium: 4, low: 1, info: 0 },
      },
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects invalid budgets, badge, and payoff priority config", () => {
    const result = validateConfigShape({
      budgets: {
        src: { maxIssues: -1, extra: true },
      },
      badge: { greenMax: -1 },
      priority: {
        churn: -1,
        severity: { severe: 10 },
      },
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /budgets\.src\.maxIssues must be a non-negative integer/);
    assert.match(result.errors.join("\n"), /budgets\.src\.extra is not allowed/);
    assert.match(result.errors.join("\n"), /badge\.greenMax must be a non-negative integer/);
    assert.match(result.errors.join("\n"), /priority\.churn must be a non-negative number/);
    assert.match(result.errors.join("\n"), /priority\.severity\.severe is not allowed/);
  });
});
