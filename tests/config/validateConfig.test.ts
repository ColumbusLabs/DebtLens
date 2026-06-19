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
});
