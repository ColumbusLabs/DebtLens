import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateConfigShape } from "../../src/config/validateConfig.js";

describe("validateConfigShape", () => {
  it("accepts comma-separated built-in packs in config", () => {
    const result = validateConfigShape({ pack: "kotlin,compose" });

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects unknown pack ids inside comma-separated config packs", () => {
    const result = validateConfigShape({ pack: "kotlin,unknown" });

    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /pack must be one or more of/);
  });
});
